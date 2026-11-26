const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};
const photos = {};

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms[code] ? makeCode() : code;
}

io.on("connection", (socket) => {
  socket.on("create-room", () => {
    const code = makeCode();
    rooms[code] = [socket.id];
    socket.join(code);
    socket.roomCode = code;
    socket.emit("joined", { code, count: 1 });
  });

  socket.on("join-room", (code) => {
    const room = rooms[code];
    if (!room) return socket.emit("error-msg", "Room not found");
    if (room.length >= 4) return socket.emit("error-msg", "Room is full");
    room.push(socket.id);
    socket.join(code);
    socket.roomCode = code;
    io.to(code).emit("joined", { code, count: room.length });
    socket.emit("peers", room.filter((id) => id !== socket.id));
  });

  // WebRTC signaling: pass messages between two people
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("pick-theme", (theme) => {
    io.to(socket.roomCode).emit("theme", theme);
  });

  socket.on("start", () => {
    const code = socket.roomCode;
    if (!rooms[code] || rooms[code].length < 4) return;

    let n = 3;
    io.to(code).emit("tick", n);

    const timer = setInterval(() => {
      n--;
      if (n > 0) {
        io.to(code).emit("tick", n);
      } else {
        clearInterval(timer);
        io.to(code).emit("capture");
      }
    }, 1000);
  });

  socket.on("photo", (img) => {
    const code = socket.roomCode;
    if (!rooms[code]) return;
    photos[code] = photos[code] || [];
    photos[code].push(img);

    if (photos[code].length === rooms[code].length) {
      io.to(code).emit("photos", photos[code]);
      delete photos[code];
    }
  });

  socket.on("retake", () => {
    io.to(socket.roomCode).emit("retake");
  });

  socket.on("disconnect", () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    rooms[code] = rooms[code].filter((id) => id !== socket.id);
    io.to(code).emit("peer-left", socket.id);
    if (rooms[code].length === 0) {
      delete rooms[code];
      delete photos[code];
    } else {
      io.to(code).emit("joined", { code, count: rooms[code].length });
    }
  });
});

server.listen(3000, () => console.log("http://localhost:3000"));