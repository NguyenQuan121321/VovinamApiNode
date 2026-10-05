import { BadRequestException } from '@nestjs/common';

export const MAX_MONEY_AMOUNT = 2_147_483_647;

/** Public VND amounts must fit the database's signed INTEGER columns. */
export function assertMoneyAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_MONEY_AMOUNT) {
    throw new BadRequestException(
      `Monetary amounts must be integers between 0 and ${MAX_MONEY_AMOUNT} VND`,
    );
  }
  return amount;
}
