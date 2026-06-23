import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
<<<<<<< HEAD
import { GetServiceCallDTO, VideoCallDto } from './personinfo.dtos';
import axios from 'axios';
=======
import { GetServiceCallDTO } from './personinfo.dtos';

>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10


@Injectable()
export class PersonInfoService {
  private readonly logger = new Logger(DatabaseService.name);
  constructor(
    private readonly db: DatabaseService,

  ) { }
  async serviceCallInfo(dto: GetServiceCallDTO) {
    try {

      const result = await this.db.runStoredProcedure('sp_infymeet', {
        Type: 2,

        TicketNo: dto.quNumber,
        CreatedBy: dto.userid,
      });

      const response = result?.recordsets?.[0]?.[0] ?? null;

      if (!response) {
        return {
          status: false,
          data: null,
          message: 'Service call not found',
        };
      }

      return {
        status: true,
        data: response,
        message: 'ServiceCall Info fetched successfully',
      };

    } catch (err) {

      this.logger.error('Failed to fetch service call info', err);

      throw err;
    }

  }
  async getMeetingClaimUserInfo(
    quNumber: string,
    email: string,
    mobile: string,
  ) {

    try {

      const result = await this.db.runStoredProcedure('sp_infymeet', {

        Type: 3,

        TicketNo: quNumber,

        DocumentName: email,

        DocumentPath: mobile,
      });

      const response = result?.recordsets?.[0]?.[0] ?? null;

      if (!response) {
        return {
          status: false,
          data: null,
          message: 'Data not found',
        };
      }

      return {
        status: true,
        data: response,
        message: 'Data fetched successfully',
      };

    } catch (err) {

      this.logger.error(
        'Failed to fetch meeting/user/claim info',
        err,
      );

      throw err;
    }
  }


  async getCustomerInfoByTicketNo(
    ticketNo: string,
  ) {

    try {

      const result =
        await this.db.runStoredProcedure(
          'sp_infymeet',
          {
            type: 7,
            TicketNo: ticketNo,
          },
        );

      return {

        status: true,

        data:
          result?.recordsets?.[0]?.[0] || null,

        message:
          'Customer info fetched successfully',
      };

    } catch (err) {

      this.logger.error(
        'Failed to fetch customer info',
        err,
      );

      throw err;
    }
  }


<<<<<<< HEAD
  async getAssignedTechniciansByTicketNo(
    ticketNo: string,
  ) {
    try {
      const result =
        await this.db.runStoredProcedure(
          'sp_infymeet',
          {
            type: 8,
            TicketNo: ticketNo,
          },
        );

      return {
        status: true,

        data:
          result?.recordsets?.[0] || [],

        message:
          'Assigned technicians fetched successfully',
      };
    } catch (err) {
      this.logger.error(
        'Failed to fetch assigned technicians',
        err,
      );

      throw err;
    }
  }
  async createVideoCall(payload: VideoCallDto) {
    try {
      const token =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtb2JpbGVObyI6IjgwNzc3MjE0ODUiLCJ0ZWNobmljaWFuSWQiOjIyMywidGVjaG5pY2lhbk5hbWUiOiJBbWFuIFNpbmdoIiwiaWF0IjoxNzgxODQ0NzUwfQ.4U_lV0t9bVlhh4d3D8u203UJIBsRNLLW3gODeLA7s6M';

      const response = await axios.post(
        'https://serviceengineerapi.infyshield.com/video-call/request',
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return {
        status: true,

        data: response.data,

        message:
          'Video call request created successfully',
      };
    } catch (err) {
      this.logger.error(
        'Failed to create video call request',
        err,
      );

      throw err;
    }
  }
=======

>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
}
