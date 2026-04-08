import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class SignalingGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // =========================
  // JOIN ROOM
  // =========================
  @SubscribeMessage('join-room')
  handleJoin(
    @MessageBody()
    data: {
      roomId: string;
      userName: string;
      isAdmin?: boolean;
      mode?: 'audio' | 'video';
    },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userName, isAdmin, mode } = data;
    client.join(roomId);

    // Store metadata on socket
    (client as any).roomId = roomId;
    (client as any).userName = userName;
    (client as any).isAdmin = !!isAdmin;
    (client as any).mode = mode || 'video';

    console.log(`✅ ${userName} joined ${roomId} (${mode ?? 'video'}) | admin=${!!isAdmin}`);

    // Notify other users in the room
    client.to(roomId).emit('user-joined', {
      socketId: client.id,
      userName,
      isAdmin,
      mode,
    });

    // Check room size
    const room = this.server.sockets.adapter.rooms.get(roomId);
    if (room && room.size === 2) {
      console.log(`🔥 Room ${roomId} ready (2 users)`);
      this.server.to(roomId).emit('ready');
    }
  }

  // =========================
  // CHAT MESSAGE
  // =========================
  @SubscribeMessage('chat-message')
  handleChat(
    @MessageBody()
    data: { roomId: string; text: string; userName: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, text, userName } = data;
    client.to(roomId).emit('chat-message', { text, userName });
    console.log(`💬 ${userName}: ${text}`);
  }

  // =========================
  // OFFER
  // =========================
  @SubscribeMessage('offer')
  handleOffer(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('offer', data);
  }

  // =========================
  // ANSWER
  // =========================
  @SubscribeMessage('answer')
  handleAnswer(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('answer', data);
  }

  // =========================
  // ICE CANDIDATE
  // =========================
  @SubscribeMessage('ice-candidate')
  handleIce(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    client.to(data.roomId).emit('ice-candidate', data);
  }

  // =========================
  // MIC TOGGLE
  // =========================
  @SubscribeMessage('toggle-mic')
  handleMicToggle(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('toggle-mic', data);
  }

  // =========================
  // HAND RAISE
  // =========================
  @SubscribeMessage('hand-raised')
  handleHandRaise(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('hand-raised', {
      userName: (client as any).userName,
    });
  }

  // =========================
  // CAMERA SWITCH (FIXED)
  // =========================
  /**
   * FIX 1: Only emit 'switch-camera' to the NON-ADMIN socket in the room.
   *         Previously: client.to(roomId) emits to ALL others — but since
   *         it's a 2-person room, that's fine. HOWEVER the real issue was
   *         that the admin's own client also received the event because
   *         the frontend was not filtering properly. Now we find the guest
   *         socket explicitly and emit only to them.
   *
   * FIX 2: Added 'camera-flip-result' handler so the guest's result
   *         (success/failure) is forwarded back to the admin socket.
   */
  @SubscribeMessage('switch-camera')
handleSwitchCamera(
  @MessageBody() data: any,
  @ConnectedSocket() client: Socket,
) {
  const roomId = data?.roomId ?? (client as any).roomId;
  const senderIsAdmin = !!(data?.isAdmin ?? (client as any).isAdmin);

  console.log('======================================');
  console.log('📷 SWITCH-CAMERA EVENT RECEIVED');
  console.log('Sender Name:', (client as any).userName);
  console.log('Sender Socket ID:', client.id);
  console.log('Room ID:', roomId);
  console.log('Is Admin:', senderIsAdmin);
  console.log('Payload:', data);
  console.log('======================================');

  // Only admin can trigger
  if (!senderIsAdmin) {
    console.warn(
      `❌ BLOCKED: Non-admin ${(client as any).userName} tried switching camera`,
    );
    return;
  }

  // Find room
  const room = this.server.sockets.adapter.rooms.get(roomId);

  console.log('📷 ROOM USERS:', room);

  if (!room) {
    console.warn(`❌ Room not found: ${roomId}`);
    return;
  }

  let guestSocketId: string | null = null;

  // Find guest socket
  for (const sid of room) {
    console.log('Checking socket:', sid);

    if (sid === client.id) {
      console.log('Skipping sender/admin socket');
      continue;
    }

    const sock = this.server.sockets.sockets.get(sid);

    console.log('Socket Metadata:', {
      id: sid,
      userName: (sock as any)?.userName,
      isAdmin: (sock as any)?.isAdmin,
    });

    if (sock && !(sock as any).isAdmin) {
      guestSocketId = sid;
      console.log('✅ Guest Found:', guestSocketId);
      break;
    }
  }

  if (!guestSocketId) {
    console.warn(`❌ No guest found in room ${roomId}`);
    return;
  }

  console.log(`📷 Sending switch-camera to guest socket ${guestSocketId}`);

  this.server.to(guestSocketId).emit('switch-camera', {
    fromAdmin: true,
    roomId,
  });

  console.log('✅ switch-camera emitted successfully');
}

  // =========================
  // CAMERA FLIP RESULT (NEW)
  // =========================
  /**
   * Guest emits this after attempting the camera flip.
   * We forward it back to the admin so they can see success/failure in their log panel.
   */
  @SubscribeMessage('camera-flip-result')
handleCameraFlipResult(
  @MessageBody() data: any,
  @ConnectedSocket() client: Socket,
) {
  const roomId = data?.roomId ?? (client as any).roomId;

  console.log('======================================');
  console.log('📷 CAMERA-FLIP-RESULT RECEIVED');
  console.log('From User:', (client as any).userName);
  console.log('From Socket:', client.id);
  console.log('Room ID:', roomId);
  console.log('Payload:', data);
  console.log('======================================');

  const room = this.server.sockets.adapter.rooms.get(roomId);

  if (!room) {
    console.warn(`❌ Room not found for flip result: ${roomId}`);
    return;
  }

  let adminSocketId: string | null = null;

  for (const sid of room) {
    console.log('Checking socket:', sid);

    if (sid === client.id) {
      console.log('Skipping sender socket');
      continue;
    }

    const sock = this.server.sockets.sockets.get(sid);

    console.log('Socket Metadata:', {
      id: sid,
      userName: (sock as any)?.userName,
      isAdmin: (sock as any)?.isAdmin,
    });

    if (sock && (sock as any).isAdmin) {
      adminSocketId = sid;
      console.log('✅ Admin Found:', adminSocketId);
      break;
    }
  }

  if (!adminSocketId) {
    console.warn('❌ No admin socket found!');
    return;
  }

  this.server.to(adminSocketId).emit('camera-flip-result', {
    success: data?.success,
    facingMode: data?.facingMode,
    error: data?.error,
  });

  console.log(
    `✅ camera-flip-result forwarded to admin socket ${adminSocketId}`,
  );
}
  // =========================
  // DISCONNECT
  // =========================
  handleDisconnect(client: Socket) {
    const roomId = (client as any).roomId;
    const userName = (client as any).userName;
    if (roomId) {
      client.to(roomId).emit('user-left', {
        userName: userName || 'User',
      });
      console.log(`❌ ${userName} left room ${roomId}`);
    }
  }
}