import cron from "node-cron";
import { queryMany } from "@workspace/db";

const TAG = "[AcidTreatNotifier]";

export async function checkAcidTreatDates(): Promise<void> {
  console.log(`${TAG} Checking for Acid Treat Deadline dates within 14 days of today...`);
  try {
    const rows = await queryMany<{
      progeny: string; cross_designed_by: string; team: string;
      acid_deadline_date: string; days_until_deadline: number;
    }>(
      `SELECT DISTINCT
         s.PROGENY AS progeny,
         v.CROSS_DESIGNED_BY AS cross_designed_by,
         s.GH_Team AS team,
         CONVERT(varchar(10), s.Acid_Deadline_Date, 23) AS acid_deadline_date,
         DATEDIFF(day, CAST(GETDATE() AS date), s.Acid_Deadline_Date) AS days_until_deadline
       FROM dbo.vw_GHSeedDesk s
       INNER JOIN dbo.vw_GH_CrossesDesk v ON v.GHSeedlingMaster_ID = s.GHSeedlingMaster_ID
       INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = s.GHSeedlingMaster_ID
       WHERE m.ACTIVE = 1
         AND s.Acid_Deadline_Date IS NOT NULL
         AND v.CROSS_DESIGNED_BY IS NOT NULL
         AND CAST(s.Acid_Deadline_Date AS date) BETWEEN CAST(GETDATE() AS date) AND DATEADD(day, 14, CAST(GETDATE() AS date))
       ORDER BY days_until_deadline, progeny`,
    );

    if (rows.length === 0) {
      console.log(`${TAG} No Acid Treat Deadline dates arriving in the next 14 days. Done.`);
      return;
    }
    console.log(`${TAG} Found ${rows.length} seed record(s) with Acid Treat Deadline dates in the next 14 days.`);

    const grouped = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!grouped.has(r.cross_designed_by)) grouped.set(r.cross_designed_by, []);
      grouped.get(r.cross_designed_by)!.push(r);
    }

    for (const [designer, items] of grouped) {
      const emp = await queryMany<{ GH_Employee: string | null; Email: string | null }>(
        `SELECT TOP 1 GH_Employee, Email FROM dbo.T_GHEmployees
          WHERE GH_Employee = @name AND Active = 1`,
        { name: designer },
      );
      const recipient = emp[0]?.Email ? { name: emp[0].GH_Employee ?? designer, email: emp[0].Email } : null;
      if (!recipient) {
        console.log(`${TAG} ⚠ ${designer} has ${items.length} upcoming Acid Treat Deadline(s) but NO email on file — skipping.`);
        continue;
      }
      const crossList = items.map((i) => `  • ${i.progeny} — Team: ${i.team} (deadline ${i.acid_deadline_date}, ${i.days_until_deadline} day(s) away)`).join("\n");
      console.log(
        `${TAG} 📧 WOULD SEND EMAIL:\n` +
        `    To: ${recipient.name} <${recipient.email}>\n` +
        `    Subject: Acid Treat Deadline Approaching — ${items.length} cross(es) need review\n` +
        `    Body:\n      Hi ${recipient.name},\n\n      The following cross(es) have Acid Treat Deadline dates approaching within the next 14 days:\n\n${crossList}\n\n      Please take appropriate action.\n\n      — Seedling Manager\n`,
      );
    }
    console.log(`${TAG} Completed. ${rows.length} notification(s) across ${grouped.size} designer(s) would be sent.`);
  } catch (err) {
    console.error(`${TAG} Error checking acid treat dates:`, err);
  }
}

export function startAcidTreatNotifier(): void {
  cron.schedule("0 6 * * *", () => {
    console.log(`${TAG} Daily check triggered at ${new Date().toISOString()}`);
    checkAcidTreatDates();
  });
  console.log(`${TAG} Scheduled daily check at 6:00 AM server time.`);
  checkAcidTreatDates();
}
