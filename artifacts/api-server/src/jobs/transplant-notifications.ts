import cron from "node-cron";
import { queryMany } from "@workspace/db";

const TAG = "[TransplantNotifier]";

export async function checkTransplantDeadlines(): Promise<void> {
  console.log(`${TAG} Checking for transplant deadlines within 14 days of today...`);
  try {
    const rows = await queryMany<{
      progeny: string; cross_designed_by: string;
      field_plant_date: string; destination: string;
      transplant_deadline_date: string; days_until_deadline: number;
    }>(
      `WITH matched AS (
         SELECT DISTINCT
           v.Progeny AS progeny, v.CROSS_DESIGNED_BY AS cross_designed_by,
           m.D1_FIELD_PLANT_DATE AS fpd, v.DESTINATION1 AS dest,
           d.Transplant_Deadline AS offset_days
         FROM dbo.vw_GH_CrossesDesk v
         INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID
         INNER JOIN dbo.M_GHDeadlines d ON d.Berry_ID = m.Berry_ID
                                       AND d.Team_ID = m.Team_ID
                                       AND d.Destination_ID = m.DESTINATION1_FK
                                       AND d.Program_ID = m.D1_PROGRAM_FK
                                       AND d.Active = 1
         WHERE m.ACTIVE = 1
           AND m.D1_FIELD_PLANT_DATE IS NOT NULL
           AND v.CROSS_DESIGNED_BY IS NOT NULL
           AND d.Transplant_Deadline IS NOT NULL
         UNION
         SELECT DISTINCT
           v.Progeny AS progeny, v.CROSS_DESIGNED_BY AS cross_designed_by,
           m.D2_FIELD_PLANT_DATE AS fpd, v.DESTINATION2 AS dest,
           d.Transplant_Deadline AS offset_days
         FROM dbo.vw_GH_CrossesDesk v
         INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID
         INNER JOIN dbo.M_GHDeadlines d ON d.Berry_ID = m.Berry_ID
                                       AND d.Team_ID = m.Team_ID
                                       AND d.Destination_ID = m.DESTINATION2_FK
                                       AND d.Program_ID = m.D2_PROGRAM_FK
                                       AND d.Active = 1
         WHERE m.ACTIVE = 1
           AND m.D2_FIELD_PLANT_DATE IS NOT NULL
           AND v.CROSS_DESIGNED_BY IS NOT NULL
           AND d.Transplant_Deadline IS NOT NULL
       )
       SELECT progeny, cross_designed_by,
              CONVERT(varchar(10), fpd, 23) AS field_plant_date,
              dest AS destination,
              CONVERT(varchar(10), DATEADD(day, offset_days, fpd), 23) AS transplant_deadline_date,
              DATEDIFF(day, CAST(GETDATE() AS date), DATEADD(day, offset_days, fpd)) AS days_until_deadline
         FROM matched
        WHERE CAST(DATEADD(day, offset_days, fpd) AS date) BETWEEN CAST(GETDATE() AS date) AND DATEADD(day, 14, CAST(GETDATE() AS date))
        ORDER BY days_until_deadline, progeny`,
    );

    if (rows.length === 0) { console.log(`${TAG} No transplant deadlines arriving in the next 14 days. Done.`); return; }
    console.log(`${TAG} Found ${rows.length} cross(es) with transplant deadlines in the next 14 days.`);

    const grouped = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!grouped.has(r.cross_designed_by)) grouped.set(r.cross_designed_by, []);
      grouped.get(r.cross_designed_by)!.push(r);
    }
    for (const [designer, items] of grouped) {
      const emp = await queryMany<{ GH_Employee: string | null; Email: string | null }>(
        `SELECT TOP 1 GH_Employee, Email FROM dbo.T_GHEmployees WHERE GH_Employee = @name AND Active = 1`,
        { name: designer },
      );
      const recipient = emp[0]?.Email ? { name: emp[0].GH_Employee ?? designer, email: emp[0].Email } : null;
      if (!recipient) {
        console.log(`${TAG} ⚠ ${designer} has ${items.length} upcoming transplant deadline(s) but NO email on file — skipping.`);
        continue;
      }
      const crossList = items.map((i) => `  • ${i.progeny} → ${i.destination} (deadline ${i.transplant_deadline_date}, ${i.days_until_deadline} day(s) away)`).join("\n");
      console.log(
        `${TAG} 📧 WOULD SEND EMAIL:\n` +
        `    To: ${recipient.name} <${recipient.email}>\n` +
        `    Subject: Transplant Deadline Approaching — ${items.length} cross(es) need review\n` +
        `    Body:\n      Hi ${recipient.name},\n\n      The following cross(es) have transplant deadlines approaching within the next 14 days:\n\n${crossList}\n\n      Please review the transplant inventory in the Seedling Manager App and adjust ship quantities requested if necessary.\n\n      — Seedling Manager\n`,
      );
    }
    console.log(`${TAG} Completed. ${rows.length} notification(s) across ${grouped.size} designer(s) would be sent.`);
  } catch (err) {
    console.error(`${TAG} Error checking transplant deadlines:`, err);
  }
}

export function startTransplantNotifier(): void {
  cron.schedule("0 6 * * *", () => {
    console.log(`${TAG} Daily check triggered at ${new Date().toISOString()}`);
    checkTransplantDeadlines();
  });
  console.log(`${TAG} Scheduled daily check at 6:00 AM server time.`);
  checkTransplantDeadlines();
}
