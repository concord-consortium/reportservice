import fs from "fs"
import path from "path"
import util from "util"
import crypto from "crypto";
import * as functions from "firebase-functions";
import admin, { firestore } from "firebase-admin";

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const parquet = require('parquetjs');

const access = util.promisify(fs.access);
const unlink = util.promisify(fs.unlink);
const readFile = util.promisify(fs.readFile);

import { AnswerData, schema, parquetInfo } from "./shared/s3-answers"

/*

  TODO:

  1. Figure out how to get syncSource from the environment
  2. Figure out how to get AWS config from the environment

*/

/*

HOW THIS WORKS:

1. createSyncDocAfterAnswerWritten runs on every write of an answer.  If the answer changes or is deleted a "sync doc"
   is created or updated which contains the run_key for the answer along with an incrementing counter starting at 1.
   In the case of deletes a "remove" flag is added.
2. monitorSyncDocCount runs as a cron job every few minutes to find all the docs with a count > 0.  Each document that is
   found has a sync field set to the current server time and has its count reset to 0.
3. syncToS3AfterSyncDocWritten runs on every write of a sync doc.  It ignores deletes of the sync doc itself.

1. per answer write create/update sync document per run_key (null, ignore) increment sync count
2. cron job looking at sync docs where count > 0 and setting flag to sync reset the count in a transaction
3. sync doc write looking for sync flag and then sync if true, then clear flag

*/

const syncSource = "TODO: GET FROM ENVIRONMENT";
const bucket = "concordqa-report-data"
const answerDirectory = `${syncSource}/partitioned-answers`
const region = "us-east-1"

const monitorSyncDocSchedule = "every 4 minutes"

interface AutoImporterSettings {
  watchAnswers: boolean;
  setNeedSync: boolean;
  sync: boolean;
}

const defaultSettings: AutoImporterSettings = {
  watchAnswers: true,
  setNeedSync: true,
  sync: true,
}

interface SyncData {
  count: number | FirebaseFirestore.FieldValue;
  need_sync?: firestore.Timestamp;
  did_sync?: firestore.Timestamp;
}

type PartialSyncData = Partial<SyncData>;

const getHash = (data: any) => {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(data));
  return hash.digest('hex');
}

const answersPath = () => `sources/${syncSource}/answers`
const answersSyncPath = () => `sources/${syncSource}/answers_async`

const getAnswerCollection = () => admin.firestore().collection(answersPath());
const getAnswerSyncCollection = () => admin.firestore().collection(answersSyncPath());

const getSettings = () => {
  return admin.firestore()
    .collection("settings")
    .doc("autoImporter")
    .get()
    .then((doc) => (doc.data() as AutoImporterSettings) || defaultSettings)
    .catch(() => defaultSettings)
}

const addSyncDoc = (runKey: string) => {
  const syncDocRef = getAnswerSyncCollection().doc(runKey);
  let syncDocData: SyncData = {
    count: admin.firestore.FieldValue.increment(1)
  };

  return admin.firestore().runTransaction((transaction) => {
    return transaction.get(syncDocRef).then((doc) => {
      if (doc.exists) {
        // add the existing field values with the new field values overwriting them
        const existingSyncDocData = doc.data() as SyncData
        syncDocData = {...existingSyncDocData, ...syncDocData}
        return transaction.update(syncDocRef, syncDocData);
      } else {
        return transaction.set(syncDocRef, syncDocData);
      }
    })
  })
};

// gets AWS creds from firebase config.
const s3Client = () => new S3Client({
  region,
  credentials: {
    accessKeyId: functions.config().aws.key,
    secretAccessKey: functions.config().aws.secret_key,
  }
});

const syncToS3 = (answers: AnswerData[]) => {
  const {run_key} = answers[0]
  const {filename, key} = parquetInfo(answers[0], answerDirectory);
  const tmpFilePath = path.join("/tmp", filename);

  const deleteFile = async () => access(tmpFilePath).then(() => unlink(tmpFilePath)).catch(() => undefined);

  return new Promise(async (resolve, reject) => {
    try {
      // parquetjs can't write to buffers
      await deleteFile();
      const writer = await parquet.ParquetWriter.openFile(schema, tmpFilePath);
      for (const answer of answers) {
        answer.answer = JSON.stringify(answer.answer)
        await writer.appendRow(answer);
      }
      await writer.close();

      const body = await readFile(tmpFilePath)

      const putObjectCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream'
      })

      await s3Client().send(putObjectCommand)

    } catch (err) {
      reject(`${run_key}: ${err.toString()}`);
    } finally {
      await deleteFile();
      resolve(true);
    }
  });
}

export const createSyncDocAfterAnswerWritten = functions.firestore
  .document(`${answersPath()}/{answerId}`) // NOTE: {answerId} is correct (NOT ${answerId}) as it is a wildcard passed to Firebase
  .onWrite((change, context) => {
    return getSettings()
      .then(({ watchAnswers }) => {
        if (watchAnswers) {
          // const answerId = context.params.answerId;
          const runKey = change.after.data()?.run_key;

          if (!runKey) {
            return null;
          }

          const beforeHash = getHash(change.before.data());
          const afterHash = getHash(change.after.data());

          if (afterHash !== beforeHash) {
            return addSyncDoc(runKey);
          }
        }

        return null;
      })
  });

export const monitorSyncDocCount = functions.pubsub.schedule(monitorSyncDocSchedule).onRun((context) => {
  return getSettings()
    .then(({ setNeedSync }) => {
      if (setNeedSync) {
        return getAnswerSyncCollection()
                  .where("count", ">", 0)
                  .get()
                  .then((querySnapshot) => {
                    const promises: Promise<FirebaseFirestore.WriteResult>[] = [];
                    querySnapshot.forEach((doc) => {
                      // use a timestamp instead of a boolean for sync so that we trigger a write
                      promises.push(doc.ref.update({
                        need_sync: firestore.Timestamp.now(),
                        count: 0
                      } as PartialSyncData));
                    });
                    return Promise.all(promises);
                  });
      }
      return null;
    });
});

export const syncToS3AfterSyncDocWritten = functions.firestore
  .document(`${answersSyncPath()}/{runKey}`) // NOTE: {answerId} is correct (NOT ${answerId}) as it is a wildcard passed to Firebase
  .onWrite((change, context) => {
    return getSettings()
      .then(({ sync }) => {
        if (sync && change.after.exists) {
          const data = change.after.data() as SyncData;

          if (data.need_sync && (!data.did_sync || (data.need_sync > data.did_sync))) {
            return getAnswerCollection()
              .where("run_key", "==", context.params.runKey)
              .get()
              .then((querySnapshot) => {
                const answers: firestore.DocumentData[] = [];
                querySnapshot.forEach((doc) => {
                  answers.push(doc.data());
                });

                const syncDocRef = getAnswerSyncCollection().doc(context.params.runKey);
                const setDidSync = () => syncDocRef.update({did_sync: firestore.Timestamp.now()} as PartialSyncData)

                if (answers.length) {
                  syncToS3(answers as AnswerData[])
                    .then(setDidSync)
                    .catch(functions.logger.error)
                }
              });
          }
        }
        return null;
      });
});
