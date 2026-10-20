import { MemberManagementView } from "@/components/admin/member-management-view";
import type { AdminProps } from "@/lib/staff-display";

export function MembersPage({ data, act, notify }: AdminProps) {

return <MemberManagementView data={data} act={act} notify={notify}/>;
}

export default MembersPage;
