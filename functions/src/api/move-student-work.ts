import admin from "firebase-admin"
import { Request, Response } from "express"

// This matches the make_source_key method in LARA's report_service.rb
export const makeSourceKey = (toolId: string) => {
  return toolId.replace(/http[|s]?:\/\/([^\/]+)/, "$1")
}

export default (req: Request, res: Response) => {
  console.log('Move started.')

  const body = req.body
  const classInfoUrl = body.class_info_url
  const currentContextId = body.current_context_id
  const newContextId = body.context_id
  const platformId = body.platform_id
  const platformUserId = body.platform_user_id
  const assignments = body.assignments

  console.log('Variables set from submitted JSON.')

  const promises:any = []

  assignments.forEach((assignment:any) => {
    console.log('Iteration through assignments begun.')
    const sourceKey = makeSourceKey(assignment.tool_id)
    console.log('Tool ID set: ' + sourceKey)
    const data = {class_info_url: classInfoUrl, context_id: newContextId, platform_id: platformId, resource_link_id: assignment.new_resource_link_id}
    console.log('Data set: ' + data)

    promises.concat(admin.firestore().collection(`sources/${sourceKey}/answers`)
      .where("context_id", "==", currentContextId)
      .where("platform_id", "==", platformId)
      .where("platform_user_id", "==", platformUserId.toString())
      .where("resource_link_id", "==", assignment.current_resource_link_id.toString())
      .get()
      .then((querySnapshot) => {
        console.log('Number of matching docs in querySnapshot: ' + querySnapshot.size)
        if (querySnapshot.size > 0) {
          promises.concat(querySnapshot.docs.map((document) => {
            const ref = document.ref
            return ref.set(data, {merge: true})
            })
          )
        } else {
          res.status(200).send("No matches")
          console.log('No matching docs for context_id=' + currentContextId + ' & platform_id=' + platformId + ' & platform_user_id=' + platformUserId + ' & resource_link_id=' + assignment.current_resource_link_id.toString())
        }
      })
    )
  })

  Promise.all(promises)
    .then( (success) => {
      res.status(200).send("Success")
      console.log('Work updated.')
    })
    .catch( (e) => {
      console.error(e)
      res.status(500).send("Error")
    })

  console.log('End.')
}