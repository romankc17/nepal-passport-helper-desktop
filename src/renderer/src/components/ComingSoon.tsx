import { Hammer } from 'lucide-react';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { PageHeader } from './PageHeader';

interface ComingSoonPageProps {
  title: string;
  description: string;
}

export function ComingSoonPage({ title, description }: ComingSoonPageProps) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <Card>
        <EmptyState
          icon={Hammer}
          title="Coming in next phase"
          description="This page is part of the feature-page phase. The API plumbing for it is already in place."
        />
      </Card>
    </div>
  );
}
