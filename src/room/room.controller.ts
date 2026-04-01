import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateRoomDto } from './room.dto';

@ApiTags('Room')
@Controller('room')
export class RoomController {

  @Get()
  @ApiOperation({ summary: 'Get all rooms' })
  getRooms() {
    return { rooms: [] };
  }


  @Post()
createRoom(@Body() body: CreateRoomDto) {
  return { message: 'Room created', data: body };
}
}