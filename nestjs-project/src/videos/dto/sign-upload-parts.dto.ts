import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';

export class SignUploadPartsDto {
  @ApiProperty({ type: [Number], minItems: 1, maxItems: 20, uniqueItems: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  part_numbers: number[];
}

export class SignedUploadPartDto {
  @ApiProperty()
  part_number: number;

  @ApiProperty({ format: 'uri' })
  url: string;

  @ApiProperty({ format: 'date-time' })
  expires_at: string;
}

export class SignedUploadPartsResponseDto {
  @ApiProperty({ type: [SignedUploadPartDto] })
  parts: SignedUploadPartDto[];
}
