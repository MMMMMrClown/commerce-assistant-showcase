import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { backgroundFailure } from '../common/background-failure';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { assertTemplateIssuable } from '../coupons/coupon-feedback';
import { CouponsService } from '../coupons/coupons.service';
import type { AuthUser } from '../common/api';
import { pagination } from '../common/api';
import { birthdaySuffixes, shanghaiDate } from './marketing-rules';
export function marketingKind(value: string) {
  if (!['BIRTHDAY', 'WELCOME'].includes(value)) throw new BadRequestException('营销玩法不存在');
  return value;
}
@Injectable()
export class MarketingService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly pendingCursors = new Map<string, { createdAt: Date; id: string }>();
  private readonly logger = new Logger(MarketingService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly coupons: CouponsService,
  ) {}
  onModuleInit() {
    const run = () => {
      void this.sweep().catch((error) =>
        this.logger.warn(backgroundFailure('member-marketing', 'scan', error)),
      );
    };
    run();
    this.timer = setInterval(run, 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async list() {
    const programs = await this.db.marketingProgram.findMany({ orderBy: { kind: 'asc' } });
    const templates = await this.db.couponTemplate.findMany({
      where: { id: { in: programs.flatMap((p) => (p.templateId ? [p.templateId] : [])) } },
      select: { id: true, name: true, startsAt: true, endsAt: true, deletedAt: true },
    });
    return programs.map((p) => ({
      ...p,
      template: templates.find((t) => t.id === p.templateId) || null,
    }));
  }
  async configure(
    user: AuthUser,
    kind: string,
    dto: { enabled: boolean; templateId?: string | null; version: number },
  ) {
    marketingKind(kind);
    if (
      typeof dto.enabled !== 'boolean' ||
      !Number.isSafeInteger(dto.version) ||
      dto.version < 1 ||
      (dto.templateId != null &&
        (typeof dto.templateId !== 'string' || dto.templateId.length > 100))
    )
      throw new BadRequestException('配置参数无效');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "kind" FROM "MarketingProgram" WHERE "kind" = ${kind} FOR UPDATE`;
      if (dto.enabled) {
        if (!dto.templateId) throw new BadRequestException('启用前请选择券模板');
        await tx.$queryRaw`SELECT "id" FROM "CouponTemplate" WHERE "id" = ${dto.templateId} FOR UPDATE`;
        const t = await tx.couponTemplate.findUnique({ where: { id: dto.templateId } });
        assertTemplateIssuable(t, new Date(), true);
      }
      const changed = await tx.marketingProgram.updateMany({
        where: { kind, version: dto.version },
        data: {
          enabled: dto.enabled,
          templateId: dto.templateId || null,
          actorId: user.id,
          version: { increment: 1 },
        },
      });
      if (!changed.count)
        throw new ConflictException({
          code: 'MARKETING_CONFIG_CHANGED',
          message:
            (kind === 'BIRTHDAY' ? '生日关怀' : '新会员礼包') +
            '配置已变化，请刷新后核对启停状态和券模板再保存',
          details: [{ kind, nextAction: 'RELOAD_PROGRAM' }],
        });
      return tx.marketingProgram.findUniqueOrThrow({ where: { kind } });
    });
  }
  async records(kind: string, query: Record<string, string>) {
    marketingKind(kind);
    if (query.page && !/^[1-9]\d{0,5}$/.test(query.page))
      throw new BadRequestException('分页参数无效');
    if (query.memberId && query.memberId.length > 100)
      throw new BadRequestException('会员参数无效');
    if (query.status && !['PENDING', 'FAILED', 'SUCCEEDED'].includes(query.status))
      throw new BadRequestException('发放状态无效');
    const p = pagination(Number(query.page), 20);
    const where = {
      kind,
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.marketingGrant.findMany({
        where,
        include: { member: { select: { name: true, avatarUrl: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: p.skip,
        take: 20,
      }),
      this.db.marketingGrant.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: 20 };
  }
  // 生日资格当天持久化；断电恢复只补已有队列，不伪造未记录的历史生日资格。
  async enrollBirthdays(now = new Date()) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "kind" FROM "MarketingProgram" WHERE "kind" = 'BIRTHDAY' FOR UPDATE`;
      const p = await tx.marketingProgram.findUnique({ where: { kind: 'BIRTHDAY' } });
      if (!p?.enabled || !p.templateId) return 0;
      const period = shanghaiDate(now).slice(0, 4);
      const members = await tx.member.findMany({
        where: {
          enabled: true,
          OR: birthdaySuffixes(now).map((s) => ({ birthday: { endsWith: s } })),
          marketingGrants: { none: { kind: 'BIRTHDAY', period } },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 100,
      });
      if (!members.length) return 0;
      const result = await tx.marketingGrant.createMany({
        data: members.map((m) => ({
          id: randomUUID(),
          kind: 'BIRTHDAY',
          memberId: m.id,
          period,
          templateId: p.templateId!,
          originalTemplateId: p.templateId!,
          programVersion: p.version,
        })),
        skipDuplicates: true,
      });
      return result.count;
    });
  }
  async process(id: string, retry = false) {
    const original = await this.db.marketingGrant.findUnique({ where: { id } });
    if (!original) throw new NotFoundException('发放记录不存在');
    let attempted = false,
      targetTemplate = original.templateId;
    try {
      return await this.db.$transaction(async (tx) => {
        // 固定锁顺序：玩法 → 发放记录 → 模板。成功券与记录同事务提交，跨进程防重。
        await tx.$queryRaw`SELECT "kind" FROM "MarketingProgram" WHERE "kind" = ${original.kind} FOR UPDATE`;
        const p = await tx.marketingProgram.findUniqueOrThrow({ where: { kind: original.kind } });
        const grant = await tx.marketingGrant.findUniqueOrThrow({ where: { id } });
        if (grant.status === 'SUCCEEDED') return grant;
        if (!p.enabled || !p.actorId || !p.templateId) {
          if (retry)
            throw new ConflictException({
              code: 'MARKETING_NOT_READY',
              message:
                (original.kind === 'BIRTHDAY' ? '生日关怀' : '新会员礼包') +
                '当前未启用或未配置券模板，请先保存有效配置后再补发',
              details: [{ kind: original.kind, nextAction: 'CONFIGURE_PROGRAM' }],
            });
          return grant;
        }
        if (grant.status === 'FAILED' && !retry) return grant;
        targetTemplate = retry ? p.templateId : grant.templateId;
        attempted = true;
        const actor = await tx.user.findUnique({ where: { id: p.actorId } });
        if (!actor?.enabled)
          throw new BadRequestException('配置操作人已停用，请管理员重新保存配置');
        const coupon = await this.coupons.issueInTransaction(
          tx,
          p.actorId,
          grant.memberId,
          targetTemplate,
          'marketing:' + grant.id,
        );
        return tx.marketingGrant.update({
          where: { id },
          data: {
            status: 'SUCCEEDED',
            templateId: targetTemplate,
            couponId: coupon.id,
            attempts: { increment: 1 },
          },
        });
      });
    } catch (e) {
      if (!attempted) throw e;
      await this.db.marketingGrant.updateMany({
        where: { id, status: { in: ['PENDING', 'FAILED'] } },
        data: {
          status: 'FAILED',
          templateId: targetTemplate,
          lastError:
            e instanceof HttpException
              ? e.message.slice(0, 200)
              : '发放失败，请核查模板或联系管理员后补发',
          attempts: { increment: 1 },
        },
      });
      return this.db.marketingGrant.findUniqueOrThrow({ where: { id } });
    }
  }
  async sweep(kind?: string) {
    if (kind) marketingKind(kind);
    if (this.running) return { busy: true, processed: 0 };
    this.running = true;
    try {
      // 【阶段隔离】生日资格生成失败不阻止已有队列（含新人礼包）处理。
      let enrollmentFailed = false;
      if (!kind || kind === 'BIRTHDAY') {
        try {
          await this.enrollBirthdays();
        } catch (error) {
          enrollmentFailed = true;
          this.logger.warn(backgroundFailure('member-marketing', 'enroll-birthdays', error));
        }
      }
      const key = kind || 'ALL';
      const load = () => {
        const cursor = this.pendingCursors.get(key);
        return this.db.marketingGrant.findMany({
          where: {
            status: 'PENDING',
            ...(kind ? { kind } : {}),
            program: { enabled: true },
            ...(cursor
              ? {
                  OR: [
                    { createdAt: { gt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                  ],
                }
              : {}),
          },
          select: { id: true, createdAt: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 100,
        });
      };
      let pending = await load();
      if (!pending.length && this.pendingCursors.has(key)) {
        this.pendingCursors.delete(key);
        pending = await load();
      }
      const last = pending.at(-1);
      if (last) this.pendingCursors.set(key, { id: last.id, createdAt: last.createdAt });
      let succeeded = 0,
        failed = 0,
        deferred = 0;
      // 【逐条隔离】业务失败仍由process持久化，技术异常不掩盖、不阻断其余记录。
      for (const g of pending) {
        try {
          const result = await this.process(g.id);
          if (result.status === 'SUCCEEDED') succeeded++;
          else if (result.status === 'FAILED') failed++;
          else deferred++;
        } catch (error) {
          failed++;
          this.logger.warn(backgroundFailure('member-marketing', 'process-grant', error, g.id));
        }
      }
      return {
        busy: false,
        processed: pending.length,
        succeeded,
        failed,
        deferred,
        enrollmentFailed,
      };
    } finally {
      this.running = false;
    }
  }
}
