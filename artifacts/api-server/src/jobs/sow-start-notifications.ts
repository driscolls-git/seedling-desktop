import cron from "node-cron";
import { queryMany } from "@workspace/db";

const TAG = "[SowStartNotifier]";

async function getAdmin3Recipients(teamName: string): Promise<{ name: string; email: string }[]> {
  const rows = await queryMany<{ name: string | null; email: string | null }>(
    `SELECT e.GH_Employee AS name, e.Email AS email
       FROM dbo.T_GHEmployees e
       INNER JOIN dbo.M_GHTeams t ON e.Team_ID = t.Team_ID
      WHERE e.UserLevel_FK = 4 AND e.Active = 1 AND t.Team_Name = @team`,
    { team: teamName },
  );
  return rows.filter((r) => r.email).map((r) => ({ name: r.name ?? "", email: r.email! }));
}

export async function checkSowStartDates(): Promise<void> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = [tomorrow.getFullYear(), String(tomorrow.getMonth() + 1).padStart(2, "0"), String(tomorrow.getDate()).padStart(2, "0")].join("-");

  console.log(`${TAG} Checking for Sow Start dates arriving on ${tomorrowStr}...`);
  try {
    const rows = await queryMany<{ progeny: string; team_name: string; sow_start_date: string }>(
      `SELECT DISTINCT v.Progeny AS progeny, v.Team_Name AS team_name,
              CONVERT(varchar(10), DATEADD(day, d.Seed_Sow_Start, m.D1_FIELD_PLANT_DATE), 23) AS sow_start_date
         FROM dbo.vw_GH_CrossesDesk v
         INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID
         INNER JOIN dbo.M_GHDeadlines d ON d.Berry_ID = m.Berry_ID
                                       AND d.Team_ID = m.Team_ID
                                       AND d.Destination_ID = m.DESTINATION1_FK
                                       AND d.Program_ID = m.D1_PROGRAM_FK
                                       AND d.Active = 1
        WHERE m.ACTIVE = 1
          AND m.D1_FIELD_PLANT_DATE IS NOT NULL
          AND d.Seed_Sow_Start IS NOT NULL
          AND CAST(DATEADD(day, d.Seed_Sow_Start, m.D1_FIELD_PLANT_DATE) AS date) = @tomorrow
        UNION
        SELECT DISTINCT v.Progeny AS progeny, v.Team_Name AS team_name,
              CONVERT(varchar(10), DATEADD(day, d.Seed_Sow_Start, m.D2_FIELD_PLANT_DATE), 23) AS sow_start_date
         FROM dbo.vw_GH_CrossesDesk v
         INNER JOIN dbo.M_GHSeedlingMaster m ON m.GHSeedlingMaster_ID = v.GHSeedlingMaster_ID
         INNER JOIN dbo.M_GHDeadlines d ON d.Berry_ID = m.Berry_ID
                                       AND d.Team_ID = m.Team_ID
                                       AND d.Destination_ID = m.DESTINATION2_FK
                                       AND d.Program_ID = m.D2_PROGRAM_FK
                                       AND d.Active = 1
        WHERE m.ACTIVE = 1
          AND m.D2_FIELD_PLANT_DATE IS NOT NULL
          AND d.Seed_Sow_Start IS NOT NULL
          AND CAST(DATEADD(day, d.Seed_Sow_Start, m.D2_FIELD_PLANT_DATE) AS date) = @tomorrow
        ORDER BY team_name, progeny`,
      { tomorrow: new Date(tomorrowStr) },
    );

    if (rows.length === 0) { console.log(`${TAG} No Sow Start dates arriving tomorrow. Done.`); return; }
    console.log(`${TAG} Found ${rows.length} cross(es) with Sow Start dates arriving tomorrow.`);

    interface Group { team: string; dateValue: string; progenyList: string[]; recipients: { name: string; email: string }[] }
    const grouped = new Map<string, Group>();
    for (const r of rows) {
      if (!r.team_name) continue;
      if (!grouped.has(r.team_name)) {
        const recipients = await getAdmin3Recipients(r.team_name);
        grouped.set(r.team_name, { team: r.team_name, dateValue: tomorrowStr, progenyList: [], recipients });
      }
      grouped.get(r.team_name)!.progenyList.push(r.progeny ?? "Unknown");
    }

    for (const n of grouped.values()) {
      if (n.recipients.length === 0) {
        console.log(`${TAG} ⚠ Sow Start Date for ${n.progenyList.length} progeny (Team: ${n.team}) arrives ${n.dateValue} — NO Admin3 employees with email found for this team.`);
        continue;
      }
      const recipientList = n.recipients.map((r) => `${r.name} <${r.email}>`).join(", ");
      const progenyLines = n.progenyList.map((p) => `  • ${p}`).join("\n");
      console.log(
        `${TAG} 📧 WOULD SEND EMAIL:\n` +
        `    To: ${recipientList}\n` +
        `    Subject: Sow Start Date Tomorrow — ${n.progenyList.length} progeny (Team: ${n.team})\n` +
        `    Body:\n      The sow start date for the following ${n.progenyList.length} progeny (Team: ${n.team}) is tomorrow (${n.dateValue}):\n\n${progenyLines}\n\n      Please take appropriate action.\n`,
      );
    }
    console.log(`${TAG} Completed. ${grouped.size} grouped notification(s) would be sent.`);
  } catch (err) {
    console.error(`${TAG} Error checking sow start dates:`, err);
  }
}

export function startSowStartNotifier(): void {
  cron.schedule("0 6 * * *", () => {
    console.log(`${TAG} Daily check triggered at ${new Date().toISOString()}`);
    checkSowStartDates();
  });
  console.log(`${TAG} Scheduled daily check at 6:00 AM server time.`);
  checkSowStartDates();
}
