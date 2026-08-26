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
  path: '/socket.io',
  cors: {
    origin: true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  // IIS/ARR often breaks permessage-deflate on the WebSocket upgrade.
  perMessageDeflate: false,
})
export class SignalingGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  // Waiting room: roomId -> (socketId -> requester info).
  // Guests who "knock" sit here until an admin admits or denies them.
  private waitingRooms = new Map<
    string,
    Map<string, { userName: string; mode: string }>
  >();

  /** Return the socket ids of all admins currently inside a room. */
  private getAdminsInRoom(roomId: string): string[] {
    const room = this.server.sockets.adapter.rooms.get(roomId);
    if (!room) return [];
    const admins: string[] = [];
    for (const sid of room) {
      const sock = this.server.sockets.sockets.get(sid);
      if (sock && (sock as any).isAdmin) admins.push(sid);
    }
    return admins;
  }

  // =========================
  // REQUEST TO JOIN (guest "knock" → waiting room)
  // =========================
  @SubscribeMessage('request-join')
  handleRequestJoin(
    @MessageBody()
    data: { roomId: string; userName?: string; mode?: 'audio' | 'video' },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId } = data;
    if (!roomId) return;

    const userName = data.userName || 'Guest';
    const mode = data.mode || 'video';

    // Keep metadata so disconnect cleanup + admit can find them later.
    (client as any).roomId = roomId;
    (client as any).userName = userName;
    (client as any).mode = mode;
    (client as any).isAdmin = false;
    (client as any).waiting = true;

    let pending = this.waitingRooms.get(roomId);
    if (!pending) {
      pending = new Map();
      this.waitingRooms.set(roomId, pending);
    }
    pending.set(client.id, { userName, mode });

    const admins = this.getAdminsInRoom(roomId);
    const reqPayload = { socketId: client.id, userName, mode };
    admins.forEach((sid) => this.server.to(sid).emit('join-request', reqPayload));

    client.emit('join-waiting', {
      roomId,
      adminPresent: admins.length > 0,
    });

    console.log(
      `🚪 ${userName} is knocking on ${roomId} | admins present: ${admins.length}`,
    );
  }

  // =========================
  // ADMIT USER (admin approves a knock)
  // =========================
  @SubscribeMessage('admit-user')
  handleAdmitUser(
    @MessageBody() data: { roomId?: string; targetId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!(client as any).isAdmin) {
      console.warn(`❌ Non-admin tried admit-user: ${(client as any).userName}`);
      return;
    }
    const roomId = data?.roomId ?? (client as any).roomId;
    const targetId = data?.targetId;
    if (!roomId || !targetId) return;

    const pending = this.waitingRooms.get(roomId);
    const wasPending = !!pending && pending.has(targetId);
    if (pending) pending.delete(targetId);

    // Idempotent: if this knock was already resolved, don't approve again
    // (prevents a second join-approved → duplicate connection).
    if (!wasPending) {
      console.log(`ℹ️ admit-user for ${targetId} ignored (already resolved)`);
      return;
    }

    // Tell the requester they're approved → they will now emit 'join-room'.
    this.server.to(targetId).emit('join-approved', { roomId });

    // Clear this knock from every other admin's pending list.
    this.getAdminsInRoom(roomId).forEach((sid) => {
      if (sid !== client.id) {
        this.server.to(sid).emit('knock-resolved', { socketId: targetId });
      }
    });

    console.log(`✅ Admin admitted ${targetId} into ${roomId}`);
  }

  // =========================
  // DENY USER (admin rejects a knock)
  // =========================
  @SubscribeMessage('deny-user')
  handleDenyUser(
    @MessageBody() data: { roomId?: string; targetId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!(client as any).isAdmin) {
      console.warn(`❌ Non-admin tried deny-user: ${(client as any).userName}`);
      return;
    }
    const roomId = data?.roomId ?? (client as any).roomId;
    const targetId = data?.targetId;
    if (!roomId || !targetId) return;

    const pending = this.waitingRooms.get(roomId);
    if (pending) pending.delete(targetId);

    this.server.to(targetId).emit('join-denied', { roomId });

    this.getAdminsInRoom(roomId).forEach((sid) => {
      if (sid !== client.id) {
        this.server.to(sid).emit('knock-resolved', { socketId: targetId });
      }
    });

    console.log(`⛔ Admin denied ${targetId} for ${roomId}`);
  }

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

    const existingRoom = this.server.sockets.adapter.rooms.get(roomId);

    // Was this exact socket already a member of this room? If so, a repeated
    // join-room (e.g. double admit) must NOT re-broadcast user-joined, or the
    // other side would build a second, conflicting peer connection.
    const alreadyInRoom = !!existingRoom && existingRoom.has(client.id);

    if (!alreadyInRoom && existingRoom && existingRoom.size >= 12) {
      console.warn(`❌ Room ${roomId} is full (12 users max). ${userName} rejected.`);
      client.emit('room-full');
      return;
    }

    client.join(roomId);

    (client as any).roomId = roomId;
    (client as any).userName = userName;
    (client as any).isAdmin = !!isAdmin;
    (client as any).mode = mode || 'video';
    (client as any).waiting = false;

    // No longer waiting (in case they were in a waiting room).
    const pendingForRoom = this.waitingRooms.get(roomId);
    if (pendingForRoom) pendingForRoom.delete(client.id);

    // An admin entering the room receives any knocks that arrived earlier.
    if (isAdmin && pendingForRoom && pendingForRoom.size) {
      const requests = [...pendingForRoom.entries()].map(([sid, info]) => ({
        socketId: sid,
        userName: info.userName,
        mode: info.mode,
      }));
      client.emit('pending-knocks', { requests });
    }

    console.log(`✅ ${userName} joined ${roomId} (${mode ?? 'video'}) | admin=${!!isAdmin}`);

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

    if (!alreadyInRoom) {
      client.to(roomId).emit('user-joined', {
        socketId: client.id,
        peerId: client.id,
        userName,
        isAdmin,
        mode,
      });
    } else {
      console.log(`↩️ ${userName} re-joined ${roomId} (suppressed duplicate user-joined)`);
    }

    const room = this.server.sockets.adapter.rooms.get(roomId);
    if (room && room.size >= 2) {
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
  }

  // =========================
  // OFFER
  // =========================
  @SubscribeMessage('offer')
  handleOffer(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    this.relayToPeer(client, 'offer', data);
  }

  // =========================
  // ANSWER
  // =========================
  @SubscribeMessage('answer')
  handleAnswer(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    this.relayToPeer(client, 'answer', data);
  }

  // =========================
  // ICE CANDIDATE
  // =========================
  @SubscribeMessage('ice-candidate')
  handleIce(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    this.relayToPeer(client, 'ice-candidate', data);
  }

  // =========================
  // MIC TOGGLE
  // =========================
  @SubscribeMessage('toggle-mic')
  handleMicToggle(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('toggle-mic', {
      ...data,
      peerId: client.id,
      socketId: client.id,
    });
  }

  // =========================
  // CAMERA TOGGLE (relay on/off so peers can spotlight the active camera)
  // =========================
  @SubscribeMessage('toggle-cam')
  handleCamToggle(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('toggle-cam', {
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
      userName: data?.userName || (client as any).userName || 'Peer',
      raised: !!data?.raised,
      socketId: client.id,
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

    // If the user was still in the waiting room, drop their knock and let
    // admins clear it from their pending list.
    if (roomId && (client as any).waiting) {
      const pending = this.waitingRooms.get(roomId);
      if (pending) pending.delete(client.id);
      this.getAdminsInRoom(roomId).forEach((sid) =>
        this.server.to(sid).emit('knock-resolved', { socketId: client.id }),
      );
      console.log(`🚪 ${userName} left the waiting room of ${roomId}`);
      return;
    }

    if (roomId) {
      client.to(roomId).emit('user-left', {
        userName: userName || 'User',
        socketId: client.id,
      });
      console.log(`❌ ${userName} left room ${roomId}`);
    }
  }
}