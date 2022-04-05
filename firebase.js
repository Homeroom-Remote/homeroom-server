const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
var admin = require("firebase-admin");

var serviceAccount = require("./homeroom-fd52a-firebase-adminsdk-pq8da-e52aa440a4.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

module.exports = {
  admin,
  db,
  getAuth,
};
