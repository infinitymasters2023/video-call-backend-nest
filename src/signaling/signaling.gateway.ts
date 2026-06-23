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

<<<<<<< HEAD
    const existingRoom = this.server.sockets.adapter.rooms.get(roomId);
    if (existingRoom && existingRoom.size >= 12) {
      console.warn(`❌ Room ${roomId} is full (12 users max). ${userName} rejected.`);
=======
    // Check room size before joining
    const existingRoom = this.server.sockets.adapter.rooms.get(roomId);
    if (existingRoom && existingRoom.size >= 6) {
      console.warn(`❌ Room ${roomId} is full (6 users max). ${userName} rejected.`);
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
      client.emit('room-full');
      return;
    }

    client.join(roomId);

<<<<<<< HEAD
=======
    // Store metadata on socket
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
    (client as any).roomId = roomId;
    (client as any).userName = userName;
    (client as any).isAdmin = !!isAdmin;
    (client as any).mode = mode || 'video';

    console.log(`✅ ${userName} joined ${roomId} (${mode ?? 'video'}) | admin=${!!isAdmin}`);

<<<<<<< HEAD
    // Tell the joiner who is already in the room
    if (existingRoom) {
      const peers: Array<{ socketId: string; userName: string; isAdmin: boolean }> = [];
      for (const sid of existingRoom) {
        if (sid === client.id) continue;
        const sock = this.server.sockets.sockets.get(sid);
        if (sock) {
          peers.push({
            socketId: sid,
            userName: (sock as any).userName || 'Guest',
            isAdmin: !!(sock as any).isAdmin,
          });
        }
      }
      if (peers.length) {
        client.emit('existing-users', { peers });
      }
    }

    client.to(roomId).emit('user-joined', {
      socketId: client.id,
      peerId: client.id,
=======
    // Notify other users in the room
    client.to(roomId).emit('user-joined', {
      socketId: client.id,
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
      userName,
      isAdmin,
      mode,
    });

<<<<<<< HEAD
    const room = this.server.sockets.adapter.rooms.get(roomId);
    if (room && room.size >= 2) {
=======
    // Check room size
    const room = this.server.sockets.adapter.rooms.get(roomId);
    if (room && room.size >= 2 && room.size <= 12) {
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
      console.log(`🔥 Room ${roomId} ready (${room.size} users)`);
      this.server.to(roomId).emit('ready');
    }
  }

  // =========================
  // CHAT MESSAGE
  // =========================
  @SubscribeMessage('chat-message')
  handleChat(
    @MessageBody()
<<<<<<< HEAD
    data: {
      roomId: string;
      text: string;
      userName?: string;
      targetId?: string;
      isAdmin?: boolean;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, text, targetId } = data;
    const payload = {
      text,
      userName: data.userName || (client as any).userName || 'Guest',
      targetId,
      fromId: client.id,
      isAdmin: !!(data.isAdmin ?? (client as any).isAdmin),
    };

    if (targetId) {
      this.server.to(targetId).emit('chat-message', payload);
      return;
    }

    client.to(roomId).emit('chat-message', payload);
    console.log(`💬 ${payload.userName}: ${text}`);
  }

  private relayToPeer(
    client: Socket,
    event: string,
    data: any,
  ) {
    const target = data?.targetId || data?.peerId;
    const payload = { ...data, senderId: client.id };

    if (target) {
      client.to(target).emit(event, payload);
      return;
    }

    if (data?.roomId) {
      client.to(data.roomId).emit(event, payload);
    }
=======
    data: { roomId: string; text: string; userName: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, text, userName } = data;
    client.to(roomId).emit('chat-message', { text, userName });
    console.log(`💬 ${userName}: ${text}`);
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
  }

  // =========================
  // OFFER
  // =========================
  @SubscribeMessage('offer')
  handleOffer(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
<<<<<<< HEAD
    this.relayToPeer(client, 'offer', data);
=======
    if (data.targetId) {
      client.to(data.targetId).emit('offer', { ...data, senderId: client.id });
    } else {
      client.to(data.roomId).emit('offer', { ...data, senderId: client.id });
    }
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
  }

  // =========================
  // ANSWER
  // =========================
  @SubscribeMessage('answer')
  handleAnswer(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
<<<<<<< HEAD
    this.relayToPeer(client, 'answer', data);
=======
    if (data.targetId) {
      client.to(data.targetId).emit('answer', { ...data, senderId: client.id });
    } else {
      client.to(data.roomId).emit('answer', { ...data, senderId: client.id });
    }
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
  }

  // =========================
  // ICE CANDIDATE
  // =========================
  @SubscribeMessage('ice-candidate')
  handleIce(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
<<<<<<< HEAD
    this.relayToPeer(client, 'ice-candidate', data);
=======
    if (data.targetId) {
      client.to(data.targetId).emit('ice-candidate', { ...data, senderId: client.id });
    } else {
      client.to(data.roomId).emit('ice-candidate', { ...data, senderId: client.id });
    }
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
  }

  // =========================
  // MIC TOGGLE
  // =========================
  @SubscribeMessage('toggle-mic')
  handleMicToggle(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
<<<<<<< HEAD
    client.to(data.roomId).emit('toggle-mic', {
      ...data,
      peerId: client.id,
      socketId: client.id,
    });
  }

  // =========================
  // MUTE REQUEST (admin)
  // =========================
  @SubscribeMessage('mute-request')
  handleMuteRequest(
    @MessageBody() data: { roomId: string; targetId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!(client as any).isAdmin) {
      console.warn(`❌ Non-admin tried mute-request: ${(client as any).userName}`);
      return;
    }

    const { roomId, targetId } = data;
    if (targetId === 'all') {
      client.to(roomId).emit('mute-request', { targetId: 'all' });
      console.log(`🔇 Admin muted all in ${roomId}`);
      return;
    }

    if (targetId) {
      this.server.to(targetId).emit('mute-request', { targetId });
    }
  }

  // =========================
  // KICK USER (admin)
  // =========================
  @SubscribeMessage('kick-user')
  handleKickUser(
    @MessageBody() data: { roomId: string; targetId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!(client as any).isAdmin) {
      console.warn(`❌ Non-admin tried kick-user: ${(client as any).userName}`);
      return;
    }

    const { roomId, targetId } = data;
    if (!targetId) return;

    const targetSock = this.server.sockets.sockets.get(targetId);
    if (targetSock) {
      targetSock.emit('kick-user', { targetId, reason: 'admin-kick' });
      setTimeout(() => {
        try { targetSock.disconnect(true); } catch { /* ignore */ }
      }, 300);
      console.log(`👢 Admin kicked ${targetId} in ${roomId ?? (client as any).roomId}`);
      return;
    }

    this.server.to(targetId).emit('kick-user', { targetId, reason: 'admin-kick' });
    console.log(`👢 Admin kicked ${targetId} (fallback emit)`);
  }

  // =========================
  // END MEETING FOR ALL (admin)
  // =========================
  @SubscribeMessage('end-meeting')
  handleEndMeeting(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!(client as any).isAdmin) {
      console.warn(`❌ Non-admin tried end-meeting: ${(client as any).userName}`);
      return;
    }

    const roomId = data?.roomId ?? (client as any).roomId;
    if (!roomId) return;

    const payload = { roomId, reason: 'admin-ended' };
    this.server.in(roomId).emit('meeting-ended', payload);
    console.log(`🛑 Admin ended meeting in ${roomId}`);
=======
    client.to(data.roomId).emit('toggle-mic', data);
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
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

  // TARGETED FLIP: If targetId is provided, send only to them
  if (data?.targetId) {
    const targetSock = this.server.sockets.sockets.get(data.targetId);
    if (targetSock) {
      console.log(`📷 TARGETED FLIP: Sending to ${data.targetId}`);
      targetSock.emit('switch-camera', data);
      return;
    }
  }

  let guestSocketId: string | null = null;
  // Fallback: Find first guest socket (original logic)
  for (const sid of room) {
    if (sid === client.id) continue;
    const sock = this.server.sockets.sockets.get(sid);
    if (sock && !(sock as any).isAdmin) {
      guestSocketId = sid;
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
        socketId: client.id,
      });
      console.log(`❌ ${userName} left room ${roomId}`);
    }
  }
}