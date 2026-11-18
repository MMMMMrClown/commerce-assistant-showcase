'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import ManagementView from './management';
export default function ProductPages({ categories = false }: { categories?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <ManagementView
      key={
        (categories ? 'categories' : 'products') +
        (params.get('categoryId') || '') +
        (params.get('state') || '')
      }
      kind={categories ? 'product-categories' : 'products'}
      initialCategoryId={params.get('categoryId') || ''}
      initialState={
        !categories && ['true', 'false', 'warning', 'recycled'].includes(params.get('state') || '')
          ? params.get('state')!
          : ''
      }
      onViewCategory={
        categories
          ? (id) => router.push('/products?categoryId=' + encodeURIComponent(id))
          : undefined
      }
    />
  );
}
