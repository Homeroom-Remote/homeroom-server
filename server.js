const config = require("config");
const colyseus = require("colyseus");
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
roomServer.define("peer", PeerMeetingRoom);

server.listen(port, onListen(port));
