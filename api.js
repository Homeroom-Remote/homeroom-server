const { db, getAuth, admin } = require("./firebase");

const errors = {
  invalid_meeting_id: "Invalid meeting ID",
  firebase_error: "Firebase error",
  empty_query: "Empty query, check your parameters",
  meeting_offline: "Meeting offline",
  invalid_token: "Invalid token",
  no_meeting_found: "No meeting found on DB",
};
const MEETINGS_COLLECTION_NAME = "meetings";
const USERS_COLLECTION_NAME = "users";

function getErrorObject(error_message_key, error) {
  return {
    message: error_message_key,
    error: error,
  };
}

function getDoc(meeting_id) {
  return db.collection(MEETINGS_COLLECTION_NAME).doc(meeting_id);
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

async function validateToken(token) {
  return new Promise((resolve, reject) => {
    if (!token)
      reject({
        code: 400,
        error: errors["invalid_token"],
      });

    getAuth()
      .verifyIdToken(token)
      .then((decodedToken) => resolve(decodedToken))
      .catch((error) => reject(error));
  });
}

async function isMeetingExists(meetingId) {
  return new Promise((resolve, reject) => {
    if (!meetingId) reject(errors["invalid_meeting_id"]);

    db.collection(MEETINGS_COLLECTION_NAME)
      .doc(meetingId)
      .get()
      .then((snapshot) => {
        if (snapshot) resolve(snapshot);
        else reject(errors["no_meeting_found"]);
      })
      .catch((e) => reject(e));
  });
}
async function openMeetingOnServer(meetingId) {
  return new Promise((resolve, reject) => {
    isMeetingExists(meetingId)
      .then((snapshot) => {
        getDoc(meetingId).update({
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          status: "online",
        });
        resolve(snapshot);
      })
      .catch((e) => reject(e));
  });
}

async function closeMeetingOnServer(meetingId) {
  return new Promise((resolve, reject) => {
    isMeetingExists(meetingId)
      .then((snapshot) => {
        console.log(snapshot.val());
        getDoc(meetingId).update({
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          status: "offline",
          participants: [],
        });
        resolve(snapshot);
      })
      .catch((e) => reject(e));
  });
}

async function addParticipantToMeeting(meetingId, uid) {
  return new Promise((resolve, reject) => {
    isMeetingExists(meetingId)
      .then((snapshot) => {
        getDoc(meetingId).update({
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          status: "online",
          participants: admin.firestore.FieldValue.arrayUnion(uid),
        });
        resolve(snapshot);
      })
      .catch((e) => reject(e));
  });
}

async function removeParticipantFromMeeting(meetingId, uid) {
  return new Promise((resolve, reject) => {
    isMeetingExists(meetingId)
      .then((snapshot) => {
        getDoc(meetingId).update({
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          status: "online",
          participants: admin.firestore.FieldValue.arrayRemove(uid),
        });
        resolve(snapshot);
      })
      .catch((e) => reject(e));
  });
}

async function addMeetingToHistory(roomID, { uid }) {
  db.collection(USERS_COLLECTION_NAME)
    .doc(uid)
    .set({
      meeting_history: admin.firestore.FieldValue.arrayUnion({
        id: roomID,
        at: admin.firestore.Timestamp.now(),
      }),
    });
}

module.exports = {
  isMeetingExists,
  isMeetingOnline,
  validateToken,
  openMeetingOnServer,
  closeMeetingOnServer,
  addParticipantToMeeting,

  removeParticipantFromMeeting,
  addMeetingToHistory,
};
