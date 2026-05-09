import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { GetServiceCallDTO } from './personinfo.dtos';



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






}
