import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UploadDocumentDto } from './media.dtos';
import * as fs from 'fs';
import * as path from 'path';
import { formToJSON } from 'axios';


@Injectable()
export class MediaService {
  private readonly logger = new Logger(DatabaseService.name);
  constructor(
    private readonly db: DatabaseService,

  ) { }
  async uploadDocument(dto: UploadDocumentDto) {

    try {

      // =========================
      // DATE
      // =========================

      const now = new Date();

      const year =
        now.getFullYear().toString();

      const monthName =
        now.toLocaleString(
          'en-US',
          { month: 'long' },
        );

      // =========================
      // GET CLIENT NAME
      // =========================

      const clientResult: any =
        await this.db.runStoredProcedure(
          'sp_infymeet',
          {
            type: 5,
            TicketNo: dto.TicketNo,
          },
        );

      const clientName =
        String(
          clientResult?.recordsets?.[0]?.[0]
            ?.clientname || 'General',
        )
          .replace(/ /g, '_')
          .replace(/[^a-zA-Z0-9_-]/g, '');
      //========================
      //Document name 
      //===========
      const docResult: any =
        await this.db.runStoredProcedure(
          'sp_infymeet',
          {
            type: 6,
            DocumentName: dto.DocumentName,
          },
        );

      const actualDocumentName =
        String(
          docResult?.recordsets?.[0]?.[0]
            ?.DocumentName || 'Document',
        )
          .replace(/[^a-zA-Z0-9_-]/g, '');
      // =========================
      // FILE EXTENSION
      // =========================

      let extension = '';

      if (
        dto.DocumentPath.startsWith(
          'data:video/webm',
        )
      ) {

        extension = '.webm';

      } else if (
        dto.DocumentPath.startsWith(
          'data:image/png',
        )
      ) {

        extension = '.png';

      } else if (
        dto.DocumentPath.startsWith(
          'data:image/jpeg',
        )
      ) {

        extension = '.jpg';

      } else if (
        dto.DocumentPath.startsWith(
          'data:application/pdf',
        )
      ) {

        extension = '.pdf';
      }

      // =========================
      // FILE NAME
      // =========================
      const timestamp =
        new Date()
          .toISOString()
          .replace(/[-:T]/g, '')
          .slice(0, 14);
      const formattedTimestamp =
        `${timestamp.slice(0, 8)}_${timestamp.slice(8, 14)}`;
      const originalName =
        path.basename(
          dto.DocumentName,
          extension,
        );
      const cleanName =
        actualDocumentName;
      // const cleanName =
      //   originalName.replace(
      //     /[^a-zA-Z0-9_-]/g,
      //     '_',
      //   );
      const cleanTicketNo =
        dto.TicketNo.replace(
          /[\/\\]/g,
          '',
        );
      const uniqueFileName =
        `${cleanTicketNo}_${cleanName}_${formattedTimestamp}${extension}`;

      // =========================
      // BASE FOLDER
      // =========================

      // const baseFolder =
      //   `D:\\yash\\document\\${clientName}\\${year}\\${monthName}`;
      const baseFolder =
        `F:\\documents\\${clientName}\\${year}\\${monthName}`;
      // =========================
      // CREATE FOLDER
      // =========================

      if (!fs.existsSync(baseFolder)) {

        fs.mkdirSync(
          baseFolder,
          { recursive: true },
        );
      }

      // =========================
      // FINAL PATH
      // =========================

      const finalPath =
        path.join(
          baseFolder,
          uniqueFileName,
        );

      // =========================
      // RELATIVE URL ONLY
      // =========================

      const publicUrl =
        `${clientName}/${year}/${monthName}/${uniqueFileName}`;

      // =========================
      // BASE64 TO FILE
      // =========================

      const base64Data =
        dto.DocumentPath.replace(
          /^data:.*;base64,/,
          '',
        );

      fs.writeFileSync(
        finalPath,
        base64Data,
        'base64',
      );

      // =========================
      // SAVE IN DB
      // =========================

      const result =
        await this.db.runStoredProcedure(
          'sp_infymeet',
          {

            type: 1,

            TicketNo:
              dto.TicketNo,

            DocumentName:
              dto.DocumentName,

            DocumentPath:
              publicUrl,

            CreatedBy:
              dto.CreatedBy,

            Remarks:
              dto.Remarks ?? null,

            Status:
              'U',
          },
        );

      return {

        status: true,

        uploadedPath:
          publicUrl,

        data:
          result?.recordsets?.[0] ?? [],

        message:
          'Document uploaded successfully',
      };

    } catch (err) {

      this.logger.error(
        'Failed to upload document',
        err,
      );

      throw err;
    }
  }

  async getDocmaster(
  ) {

    try {

      const result = await this.db.runStoredProcedure('sp_infymeet', {

        Type: 4,
      });

      const response = result?.recordsets ?? null;

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
