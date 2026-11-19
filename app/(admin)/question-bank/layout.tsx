import { AdminGate } from "@/components/app/role-gates"

export default async function QuestionBankAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AdminGate>{children}</AdminGate>
}
