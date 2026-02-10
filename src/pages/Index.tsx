import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";
import { ClientDashboard } from "@/components/dashboard/ClientDashboard";

export default function Index() {
  const { isAdmin } = useAuth();

  return (
    <AppLayout title="Dashboard">
      {isAdmin ? <AdminDashboard /> : <ClientDashboard />}
    </AppLayout>
  );
}
