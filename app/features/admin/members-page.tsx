import { MemberManagementView } from "@/app/member-management-view";
import type { AdminProps } from "@/app/features/shared/staff-display";

export function MembersPage({ data, act, notify }: AdminProps) {

return <MemberManagementView data={data} act={act} notify={notify}/>;
}

export default MembersPage;
