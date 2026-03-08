import { DashboardNav } from './DashboardNav';

const isSelfHosted = process.env.SELF_HOSTED === 'true';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardNav isSelfHosted={isSelfHosted}>{children}</DashboardNav>;
}
