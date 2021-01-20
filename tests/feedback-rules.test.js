// const firebase = require("firebase/app");
// require("firebase/firestore");
const firebase = require("@firebase/rules-unit-testing");


function testFeedback(path, label, perStudent) {
  describe('with an anonymous user', () => {
    let testApp = null;

    beforeAll(() => {
      testApp = firebase.initializeTestApp({
        projectId: "report-service-dev",
        auth: null
      });
    })

    afterAll(async () => {
      await testApp.delete();
    });

    it(`fails to create random document`, async () => {
      await firebase.assertFails(testApp.firestore()
        .collection(path)
        .add({
          randomKey: "hello world"
        }));
    });

    // TODO add more create tests here with platform_id, class_hash

    it(`cannot find and read ${label}s`, async () => {
      const query = testApp.firestore()
        .collection(path);

      await firebase.assertFails(query.get());
    });

    // TODO add more listing tests here with platform_id, class_hash
  });

  // TODO: These tests would be easier to write and read if we could populate
  // the database with documents regardless of the current rules
  // the docs say we can use initalizeAdminApp for this, but when I tried that
  // there was a complaint about a missing library
  describe("with a logged in teacher", () => {
    let testApp = null;
    let testAppOtherClass = null;

    beforeAll(() => {
      testApp = firebase.initializeTestApp({
        projectId: "report-service-dev",
        auth: {
          user_id: "not_sure_what_this_is",
          user_type: "teacher",
          // TODO use a typical value here
          platform_id: "https://portal.concord.org",
          // TODO check why we are using string() in the rules
          // perhaps we are sending numbers instead of strings in some cases
          platform_user_id: "abcd",
          class_hash: "qwerty"
        }
      });

      testAppOtherClass = firebase.initializeTestApp({
        projectId: "report-service-dev",
        auth: {
          user_id: "not_sure_what_this_is",
          user_type: "teacher",
          // TODO use a typical value here
          platform_id: "https://portal.concord.org",
          platform_user_id: "abcd",
          class_hash: "different-qwerty"
        }
      });
    })

    afterAll(async () => {
      await testApp.delete();
      await testAppOtherClass.delete();
    });

    const validFeedback = {
      platformId: "https://portal.concord.org",
      contextId: "qwerty",
    };

    it(`creates ${label}s that match the auth`, async () => {
      await firebase.assertSucceeds(testApp.firestore()
        .collection(path)
        .add(validFeedback));
    });

    it(`fails to create ${label}s that with incorrect platformId`, async () => {
      await firebase.assertFails(testApp.firestore()
        .collection(path)
        .add({
            ...validFeedback,
            platformId: "incorrect platform id"
        }));
    });

    it(`fails to create ${label}s that with incorrect contextId`, async () => {
      await firebase.assertFails(testApp.firestore()
        .collection(path)
        .add({
            ...validFeedback,
            contextId: "incorrect context id"
        }));
    });

    it(`can read ${label}s with the same contextId`, async () => {
      // query document
      const query = await testApp.firestore()
        .collection(path)
        .where("platformId", "==", "https://portal.concord.org")
        .where("contextId", "==", "qwerty");

      await firebase.assertSucceeds(query.get());
    });

    it(`cannot read ${label}s from a different contextId`, async () => {
      const query = await testApp.firestore()
        .collection(path)
        .where("platformId", "==", "https://portal.concord.org")
        .where("contextId", "==", "different-qwerty");

      await firebase.assertFails(query.get());
    });

    it(`cannot read ${label}s from a different platform`, async () => {
      const query = await testApp.firestore()
        .collection(path)
        .where("platformId", "==", "https://portal.staging.concord.org")
        .where("contextId", "==", "qwerty");

      await firebase.assertFails(query.get());
    });

    describe(`with an existing ${label}`, () => {
      let feedbackDoc = null;

      beforeAll(async () => {
        feedbackDoc = await testApp.firestore()
          .collection(path)
          .add(validFeedback);
      })

      it(`can update a ${label} with new content`, async () => {
        await firebase.assertSucceeds(feedbackDoc.
          update({
            fakeProperty: "some value"
          }));
      });

      it(`cannot change the platform_id of a ${label}`, async () => {
        await firebase.assertFails(feedbackDoc.
          update({
            platformId: "invalid platform_id"
          }));
      });

      it(`cannot change the context_id of a ${label}`, async () => {
        await firebase.assertFails(feedbackDoc.
          update({
            contextId: "invalid context_id"
          }));
      });
    });

  });

  // TODO: need to figure out how to conditionalize this
  // in the case of feedback settings, the documents don't have platformStudentId
  describe("with a logged in student", () => {
    let testApp = null;

    beforeAll(() => {
      testApp = firebase.initializeTestApp({
        projectId: "report-service-dev",
        auth: {
          user_id: "not_sure_what_this_is",
          user_type: "learner",
          // TODO use a typical value here
          platform_id: "https://portal.concord.org",
          // This value isn't strictly necessary for testing answers by teachers
          // but other document types might need it
          platform_user_id: "abcd-student",
          class_hash: "qwerty"
        }
      });
    })

    afterAll(async () => {
      await testApp.delete();
    });

    it(`cannot create ${label}s`, async () => {
      await firebase.assertFails(testApp.firestore()
        .collection(path)
        .add({anything: "value"}));
    });

    if (perStudent) {
      it(`can read ${label}s in same context for this student`, async () => {
        const query = testApp.firestore()
          .collection(path)
          .where("platformId", "==", "https://portal.concord.org")
          .where("contextId", "==", "qwerty")
          .where("platformStudentId", "==", "abcd-student");
        await firebase.assertSucceeds(query.get());
      })

      it(`can read ${label}s in different context`, async () => {
        const query = await testApp.firestore()
          .collection(path)
          .where("platformId", "==", "https://portal.concord.org")
          .where("contextId", "==", "qwerty-other")
          .where("platformStudentId", "==", "abcd-student");
        await firebase.assertSucceeds(query.get());
      })

      it(`cannot read ${label}s from a different platform`, async () => {
        const query = await testApp.firestore()
          .collection(path)
          .where("platformId", "==", "https://portal.staging.concord.org")
          .where("contextId", "==", "qwerty")
          .where("platformStudentId", "==", "abcd-student");
        await firebase.assertFails(query.get());
      });

      it(`cannot read ${label}s for a different student`, async () => {
        const query = await testApp.firestore()
          .collection(path)
          .where("platformId", "==", "https://portal.concord.org")
          .where("contextId", "==", "qwerty")
          .where("platformStudentId", "==", "abcd-other-student");
        await firebase.assertFails(query.get());
      });
    } else {
      it(`can read ${label}s in the auth context`, async () => {
        const query = testApp.firestore()
          .collection(path)
          .where("platformId", "==", "https://portal.concord.org")
          .where("contextId", "==", "qwerty");
        await firebase.assertSucceeds(query.get());
      })

      it(`cannot read ${label}s in different context`, async () => {
        const query = await testApp.firestore()
          .collection(path)
          .where("platformId", "==", "https://portal.concord.org")
          .where("contextId", "==", "qwerty-other");
        await firebase.assertFails(query.get());
      })

      it(`cannot read ${label}s from a different platform`, async () => {
        const query = await testApp.firestore()
          .collection(path)
          .where("platformId", "==", "https://portal.staging.concord.org")
          .where("contextId", "==", "qwerty")
        await firebase.assertFails(query.get());
      });
    }

    describe(`with an existing ${label}`, () => {

      beforeAll(async () => {
        const testAppTeacher = firebase.initializeTestApp({
          projectId: "report-service-dev",
          auth: {
            user_id: "not_sure_what_this_is",
            user_type: "teacher",
            // TODO use a typical value here
            platform_id: "https://portal.concord.org",
            platform_user_id: "abcd-teacher",
            class_hash: "qwerty"
          }
        });

        const existingDoc = {
          platformId: "https://portal.concord.org",
          contextId: "qwerty"
        }

        if (perStudent) {
          existingDoc.platformStudentId = "abcd-student";
        }

        await testAppTeacher.firestore()
          .collection(path)
          .add(existingDoc);

        await testAppTeacher.delete();
      });

      it(`cannot update ${label}`, async () => {
        expect.assertions(1);
        let query = await testApp.firestore()
          .collection(path)
          .where("platformId", "==", "https://portal.concord.org")
          .where("contextId", "==", "qwerty");

        if (perStudent) {
          query = query.where("platformStudentId", "==", "abcd-student");
        }

        const querySnapshot = await query.get();
        expect(querySnapshot.empty).toBe(false);
        const feedbackRef = querySnapshot.docs[0].ref;

        await firebase.assertFails(feedbackRef.update({
          studentInfo: "should not work"
        }));
      });
    });
  });
}

describe("Question Feedbacks", () =>
  testFeedback("sources/example.com/question_feedbacks", "question feedback", true));

describe("Activity Feedbacks", () =>
  testFeedback("sources/example.com/activity_feedbacks", "activity feedback", true));

describe("Feedback Settings", () =>
  testFeedback("sources/example.com/feedback_settings", "feedback setting", false));
