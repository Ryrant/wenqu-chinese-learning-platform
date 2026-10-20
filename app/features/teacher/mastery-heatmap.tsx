import { numberValue, stringValue } from "@/app/lib/platform-types";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LoopProps } from "@/app/features/shared/learning-display";

export function TeacherMasteryHeatmap({ data }: Pick<LoopProps, "data">) {
  const objectives = data.learningObjectives.filter((item) => item.status !== "inactive");
  const students = [...new Map(data.enrollments.filter((item) => item.status === "active").map((item) => [String(item.studentUserId), stringValue(item.studentName)])).entries()];
  const valueByCell = new Map(data.masteryMatrix.map((item) => [`${item.studentUserId}:${item.objectiveId}`, numberValue(item.mastery)]));

  return <Card className="panel loop-panel">
    <div className="panel-heading"><div><h3>班级学情</h3></div><span>{students.length} 名学生</span></div>
    {students.length && objectives.length ? <div className="table-wrap"><Table className="heatmap">
      <TableHeader><TableRow><TableHead>学生</TableHead>{objectives.map((item) => <TableHead key={String(item.id)} title={stringValue(item.title)}>{stringValue(item.skill)}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{students.map(([studentId, studentName]) => <TableRow key={studentId}><TableHead>{studentName}</TableHead>{objectives.map((objective) => {
        const value = valueByCell.get(`${studentId}:${objective.id}`);
        const percent = value === undefined ? null : Math.round(value * 100);
        return <TableCell key={String(objective.id)} className={percent === null ? "unknown" : percent < 60 ? "low" : percent < 80 ? "medium" : "high"}>{percent === null ? "—" : `${percent}%`}</TableCell>;
      })}</TableRow>)}</TableBody>
    </Table></div> : <p className="empty-state">学生产生诊断或已确认作业证据后，这里会显示最新掌握度。</p>}
  </Card>;
}

export default TeacherMasteryHeatmap;
