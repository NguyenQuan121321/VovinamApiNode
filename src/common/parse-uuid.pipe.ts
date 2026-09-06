import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';

/**
 * Every route parameter that is a UUID is validated before it reaches a Prisma
 * query: a malformed id would otherwise hit Postgres as P2023 and surface as a
 * 500. Malformed ids answer 400 (there is nothing to probe); well-formed ids of
 * foreign resources still answer the uniform 404 (plan 7.3).
 */
export class ParseUuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !isUUID(value)) {
      throw new BadRequestException('Invalid id format');
    }
    return value;
  }
}
