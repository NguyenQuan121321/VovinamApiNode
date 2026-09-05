import { IsString, Length } from 'class-validator';

export class TotpCodeDto {
  @IsString()
  @Length(6, 12)
  code!: string;
}

export class TotpDisableDto {
  @IsString()
  @Length(6, 12)
  code!: string;

  @IsString()
  @Length(1, 128)
  password!: string;
}

export class MfaLoginVerifyDto {
  @IsString()
  @Length(10, 1000)
  mfaToken!: string;

  @IsString()
  @Length(6, 12)
  code!: string;
}
