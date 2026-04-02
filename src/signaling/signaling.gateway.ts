import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class SignalingGateway {
  @WebSocketServer()
  server: Server;

  // JOIN ROOM
 @SubscribeMessage('join-room')
handleJoin(
  @MessageBody() data: { roomId: string; userName: string },
  @ConnectedSocket() client: Socket,
) {
  client.join(data.roomId);

  // Notify others
  client.to(data.roomId).emit('user-joined', {
    socketId: client.id,
    userName: data.userName,
  });

  // 🔥 IMPORTANT FIX: SEND READY WHEN 2 USERS PRESEN
  const room = this.server.sockets.adapter.rooms.get(data.roomId);

  if (room && room.size === 2) {
    console.log(`🔥 Room ${data.roomId} ready (2 users)`);

    // Send to BOTH users
    this.server.to(data.roomId).emit('ready');
  }
}

  // OFFER
  @SubscribeMessage('offer')
  handleOffer(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('offer', data);
  }

  // ANSWER
  @SubscribeMessage('answer')
  handleAnswer(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('answer', data);
  }

  // ICE
  @SubscribeMessage('ice-candidate')
  handleIce(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('ice-candidate', data);
  }
}