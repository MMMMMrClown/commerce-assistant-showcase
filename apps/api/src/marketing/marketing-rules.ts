import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
export function shanghaiDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function validateBirthday(value: string | null | undefined, now = new Date()) {
  if (value == null) return;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > shanghaiDate(now) ||
    !Number.isFinite(new Date(value + 'T00:00:00Z').getTime()) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('生日需为1900年至今天之间的真实日期');
}
export function birthdaySuffixes(now = new Date()) {
  const date = shanghaiDate(now),
    year = Number(date.slice(0, 4)),
    suffixes = [date.slice(5)];
  if (date.endsWith('02-28') && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1)
    suffixes.push('02-29');
  return suffixes;
}
// 资格随会员创建同事务入队；停用期间新增和历史会员不追发。
export async function enrollWelcome(tx: Prisma.TransactionClient, memberId: string) {
  await tx.$queryRaw`SELECT "kind" FROM "MarketingProgram" WHERE "kind" = 'WELCOME' FOR UPDATE`;
  const p = await tx.marketingProgram.findUnique({ where: { kind: 'WELCOME' } });
  const member = await tx.member.findUniqueOrThrow({ where: { id: memberId } });
  if (p?.enabled && p.templateId && member.enabled)
    await tx.marketingGrant.create({
      data: {
        kind: p.kind,
        memberId,
        period: 'ONCE',
        templateId: p.templateId,
        originalTemplateId: p.templateId,
        programVersion: p.version,
      },
    });
}
