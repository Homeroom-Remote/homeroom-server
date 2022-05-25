const config = require("config");
const colyseus = require("colyseus");
const matchMaker = require("colyseus").matchMaker;
const express = require("express");
const app = express();
const server = require("http").Server(app);
const PeerMeetingRoom = require("./rooms/PeerMeeting");

const onListen = (port) => (err) => {
  if (err) throw err;
  console.log(`Server listening on port ${port}`);
};

const port = process.env.PORT || config.app.port;

const roomServer = new colyseus.Server({ server });
app.get("/", async (req, res) => {
  const rooms = await matchMaker.query({ name: "peer" });
  res.send(rooms);
});
roomServer.define("peer", PeerMeetingRoom);

server.listen(port, onListen(port));
