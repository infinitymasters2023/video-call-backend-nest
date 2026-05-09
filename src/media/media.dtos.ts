import { ApiProperty } from "@nestjs/swagger";

export class UploadDocumentDto {


  @ApiProperty()
  TicketNo!: string;

  @ApiProperty()
  DocumentName!: string;

  @ApiProperty()
  DocumentPath!: string;


  @ApiProperty({ required: false })
  Remarks?: string;

  @ApiProperty({ default: 'U', required: false })
  Status?: string;
  CreatedBy: any;



}