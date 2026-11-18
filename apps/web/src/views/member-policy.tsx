'use client';
import Link from 'next/link';
import { MarketingBenefits } from './member-marketing';
import { BenefitPolicyCard } from '@/components/members/benefit-policy';
import { PageHeader, Card } from '@/components/ui';
import { useAppSelector } from '@/store/store';
export default function MemberPolicy({ benefits = false }: { benefits?: boolean }) {
  const canManage = useAppSelector(
    (s) => s.auth.user?.permissions.includes('member:benefits-manage') ?? false,
  );
  return (
    <>
      <PageHeader
        title={benefits ? '会员权益' : '会员等级'}
        description={
          benefits ? '折扣和积分规则；配置统一在会员等级维护' : '维护六档成长门槛、折扣和积分倍率'
        }
      />
      <BenefitPolicyCard
        mode={benefits ? 'benefits' : 'tiers'}
        canManage={!benefits && canManage}
        onChanged={() => {}}
      />
      {benefits && <MarketingBenefits />}
      {benefits && (
        <Card className="p-5">
          <p>积分目前支持累计与查询，个人权益流水从会员详情查看。</p>
          <Link href="/members">查看会员及权益流水 →</Link>
        </Card>
      )}
    </>
  );
}
