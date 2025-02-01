import { Server } from 'socket.io';

// Track active streams
const activeStreams = new Map();

const ioHandler = (req, res) => {
  if (!res.socket.server.io) {
    const io = new Server(res.socket.server, {
      path: '/api/socket',
      addTrailingSlash: false,
    });

    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      // Send current active streams to newly connected clients
      socket.emit('active-streams', Array.from(activeStreams.keys()));

      socket.on('join-room', (roomId) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-joined', socket.id);
      });

      socket.on('start-stream', (roomId) => {
        activeStreams.set(roomId, socket.id);
        io.emit('stream-started', roomId);
      });

      socket.on('signal', ({ to, from, signal }) => {
        io.to(to).emit('signal', { from, signal });
      });

      socket.on('disconnect', () => {
        // Remove any streams this socket was broadcasting
        for (const [roomId, streamerId] of activeStreams.entries()) {
          if (streamerId === socket.id) {
            activeStreams.delete(roomId);
            io.emit('stream-ended', roomId);
          }
        }
        console.log('Client disconnected:', socket.id);
      });
    });

    res.socket.server.io = io;
  }
  res.end();
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export default ioHandler; 