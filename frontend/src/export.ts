import type {Workspace} from './finance';
import {income,accounts,today} from './finance';
export async function exportExcel(data:Workspace){
  const module=await import('exceljs'),ExcelJS=module.default??module,workbook=new ExcelJS.Workbook();
  workbook.creator='Pay & Plan Standalone';workbook.created=new Date();
  const sheet=(name:string,headers:string[],rows:(string|number|null|undefined)[][])=>{const s=workbook.addWorksheet(name);s.addRow(headers);rows.forEach(row=>s.addRow(row));s.views=[{state:'frozen',ySplit:1}];s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF14243F'}};s.columns.forEach(c=>c.width=21)};
  const value=(n:number|null|undefined)=>n==null?null:n/100;
  sheet('Payroll',['Status','Employer','Pay date','Period start','Period end','Gross CAD','Net CAD','Withheld CAD','Regular hours','Tips','Notes'],data.payrolls.map(p=>[p.status,p.employer,p.payDate,p.periodStart,p.periodEnd,value(p.gross),value(p.net),value(p.withheld),value(p.hours),value(p.tips),p.notes]));
  sheet('Balance History',['Date','Account','Kind','Balance CAD'],data.snapshots.flatMap(s=>data.accounts.map(a=>[s.date,a.name,a.kind,value(s.balances[a.id])])));
  sheet('Plan',['Name','Type','Amount CAD','Frequency','Next date','Status','Reserved CAD'],data.plan.map(p=>[p.label,p.kind,value(p.amount),p.frequency,p.nextDate,p.status,value(p.reserved)]));
  sheet('Spending',['Month','Living CAD','Tuition CAD','Budget CAD'],data.spending.map(p=>[p.month,value(p.living),value(p.tuition),value(p.budget)]));
  const summary=income(data.payrolls),a=accounts(data);
  sheet('Summary',['Metric','Value'],[['Export date',today()],['Confirmed payroll count',summary.count],['Gross income CAD',value(summary.gross)],['Net income CAD',value(summary.net)],['Regular hours',summary.hours],['Current cash CAD',value(a.cash)],['Net worth CAD',value(a.netWorth)],['Cash buffer CAD',value(data.settings.buffer)]]);
  const buffer=await workbook.xlsx.writeBuffer(),url=URL.createObjectURL(new Blob([buffer as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const aTag=document.createElement('a');aTag.href=url;aTag.download='Pay-and-Plan-'+today()+'.xlsx';aTag.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
