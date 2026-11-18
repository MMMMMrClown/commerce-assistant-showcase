import { enrollWelcome, shanghaiDate, validateBirthday } from '../marketing/marketing-rules';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto, UpdateMemberDto } from './member.dto';
import { pagination } from '../common/api';
import { MemberBenefitsService } from '../member-benefits/member-benefits.service';
import { describeBenefits } from '../member-benefits/benefit-rules';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly benefits: MemberBenefitsService,
  ) {}

  // 【运营聚合】只返回会员统计与权益规则，不向模型发送姓名、手机号。
  async statistics(start: Date, end: Date) {
    const [total, enabled, newMembers, members, policy] = await Promise.all([
      this.prisma.member.count(),
      this.prisma.member.count({ where: { enabled: true } }),
      this.prisma.member.count({ where: { createdAt: { gte: start, lte: end } } }),
      this.prisma.member.groupBy({ by: ['tierOverride', 'totalSpent'], _count: { _all: true } }),
      this.benefits.policy(),
    ]);
    const distribution: Record<string, number> = {};
    for (const member of members) {
      const tier = describeBenefits({ ...member, points: 0 }, policy).tierName;
      distribution[tier] = (distribution[tier] || 0) + member._count._all;
    }
    return {
      total,
      enabled,
      newMembers,
      distribution,
      policy,
      scope: '全平台会员档案；不代表门店归属或权益使用率',
    };
  }

  async detail(id: string) {
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) throw new NotFoundException('会员不存在');
    return { ...member, ...describeBenefits(member, await this.benefits.policy()) };
  }

  async list(query: Record<string, string>) {
    const { page, pageSize, skip, take } = pagination(Number(query.page), Number(query.pageSize));

    const keyword = query.keyword?.trim();

    const where: Prisma.MemberWhereInput = {
      AND: [
        keyword
          ? {
              OR: [
                { name: { contains: keyword, mode: 'insensitive' } },
                { phone: { contains: keyword } },
              ],
            }
          : {},
        ...(['true', 'false'].includes(query.enabled)
          ? [{ enabled: query.enabled === 'true' }]
          : []),
      ],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.member.findMany({
        where,
        skip,
        take,
        orderBy: [
          {
            [['name', 'phone', 'totalSpent', 'points', 'enabled'].includes(query.sortBy)
              ? query.sortBy
              : 'createdAt']: query.sortDirection === 'asc' ? 'asc' : 'desc',
          },
          { id: 'desc' },
        ],
      }),
      this.prisma.member.count({ where }),
    ]);

    const policy = await this.benefits.policy();
    return {
      items: items.map((member) => ({ ...member, ...describeBenefits(member, policy) })),
      total,
      page,
      pageSize,
    };
  }

  async create(dto: CreateMemberDto) {
    try {
      validateBirthday(dto.birthday);
      return await this.prisma.$transaction(async (tx) => {
        const member = await tx.member.create({
          data: {
            ...dto,
            birthdayChangedYear: dto.birthday ? Number(shanghaiDate().slice(0, 4)) : null,
          },
        });
        await enrollWelcome(tx, member.id);
        return member;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该手机号已存在');
      }

      throw error;
    }
  }
  async update(id: string, dto: UpdateMemberDto) {
    try {
      validateBirthday(dto.birthday);
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Member" WHERE "id" = ${id} FOR UPDATE`;
        const before = await tx.member.findUniqueOrThrow({ where: { id } });
        const changed = dto.birthday !== undefined && dto.birthday !== before.birthday;
        const year = Number(shanghaiDate().slice(0, 4));
        if (changed && before.birthdayChangedYear === year)
          throw new ConflictException('生日资料每自然年最多修改一次');
        return tx.member.update({
          where: { id },
          data: { ...dto, ...(changed ? { birthdayChangedYear: year } : {}) },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('该手机号已存在');
        }

        if (error.code === 'P2025') {
          throw new NotFoundException('会员不存在');
        }
      }

      throw error;
    }
  }
}
