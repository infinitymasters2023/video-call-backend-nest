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

      // MONTH NAME
      const monthName =
        now.toLocaleString(
          'en-US',
          { month: 'long' },
        );

      // =========================
      // FILE EXTENSION
      // =========================

      const extension =
        path.extname(
          dto.DocumentName,
        );

      // FILE NAME WITHOUT EXTENSION
      const originalName =
        path.basename(
          dto.DocumentName,
          extension,
        );

      // CLEAN FILE NAME
      const cleanName =
        originalName.replace(
          /[^a-zA-Z0-9_-]/g,
          '_',
        );

      // UNIQUE FILE NAME
      const uniqueFileName =
        `${Date.now()}_${cleanName}${extension}`;

      // =========================
      // BASE FOLDER
      // =========================

      const baseFolder =
        `F:\\documents\\videocall\\${year}\\${monthName}`;
      // const baseFolder =
      //   `D:\\yash\\document\\${year}\\${monthName}`;

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
      // FINAL PHYSICAL PATH
      // =========================

      const finalPath =
        path.join(
          baseFolder,
          uniqueFileName,
        );

      // =========================
      // PUBLIC URL
      // =========================

      const publicUrl =
        `https://doc.infyshield.com/Documents/${year}/${monthName}/${uniqueFileName}`;
      // const publicUrl =
      //   `http://localhost:5083/Documents/${year}/${monthName}/${uniqueFileName}`;

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
              uniqueFileName,

            // SAVE URL
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
  // async uploadDocument(dto: UploadDocumentDto) {

  //   try {

  //     // =========================
  //     // CREATE YEAR / MONTH PATH
  //     // =========================

  //     const now = new Date();

  //     const year =
  //       now.getFullYear().toString();

  //     const month =
  //       (now.getMonth() + 1)
  //         .toString()
  //         .padStart(2, '0');

  //     // const baseFolder =
  //     //   `F:\\documents\\videocall\\${year}\\${month}`;

  //     const baseFolder =
  //       `D:\\yash\\document\\${year}\\${month}`
  //     // =========================
  //     // CREATE FOLDER
  //     // =========================

  //     if (!fs.existsSync(baseFolder)) {

  //       fs.mkdirSync(
  //         baseFolder,
  //         { recursive: true },
  //       );
  //     }

  //     // =========================
  //     // FILE NAME
  //     // =========================

  //     const uniqueFileName =
  //       `${Date.now()}_${dto.DocumentName}`;

  //     const finalPath =
  //       path.join(
  //         baseFolder,
  //         uniqueFileName,
  //       );

  //     // =========================
  //     // BASE64 TO IMAGE FILE
  //     // =========================

  //     const base64Data =
  //       dto.DocumentPath.replace(
  //         /^data:.*;base64,/,
  //         '',
  //       );

  //     fs.writeFileSync(
  //       finalPath,
  //       base64Data,
  //       'base64',
  //     );

  //     // =========================
  //     // SAVE PATH IN DB
  //     // =========================

  //     const result =
  //       await this.db.runStoredProcedure(
  //         'sp_infymeet',
  //         {

  //           type: 1,

  //           TicketNo:
  //             dto.TicketNo,

  //           DocumentName:
  //             dto.DocumentName,

  //           DocumentPath:
  //             finalPath,

  //           CreatedBy:
  //             dto.CreatedBy,

  //           Remarks:
  //             dto.Remarks ?? null,

  //           Status:
  //             'U',
  //         },
  //       );

  //     return {

  //       status: true,

  //       uploadedPath:
  //         finalPath,

  //       data:
  //         result?.recordsets?.[0] ?? [],

  //       message:
  //         'Document uploaded successfully',
  //     };

  //   } catch (err) {

  //     this.logger.error(
  //       'Failed to upload document',
  //       err,
  //     );

  //     throw err;
  //   }
  // }
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
