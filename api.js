const { db } = require("./firebase");

const errors = {
  invalid_meeting_id: "Invalid meeting ID",
  firebase_error: "Firebase error",
  empty_query: "Empty query, check your parameters",
  meeting_offline: "Meeting offline",
};
const MEETINGS_COLLECTION_NAME = "meetings";

function getErrorObject(error_message_key, error) {
  return {
    message: error_message_key,
    error: error,
  };
}

function isMeetingOnline(meetingID) {
  return new Promise((resolve, reject) => {
    if (!meetingID) reject(getErrorObject(invalid_meeting_id));
    db.collection(MEETINGS_COLLECTION_NAME)
      .doc(meetingID)
      .get()
      .then((snapshot) => {
        if (!snapshot?.data()) reject(empty_query);
        if (snapshot.data().status !== "online")
          reject(errors["meeting_offline"]);
        resolve(snapshot.data());
      })
      .catch((error) => reject(getErrorObject(firebase_error, error)));
  });
}

module.exports = {
  isMeetingOnline,
};
