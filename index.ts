import { GoogleGenAI } from "@google/genai";

import { simpleGit, type SimpleGit } from "simple-git";
import * as dotenv from "dotenv";
import { program } from "commander";
import * as path from "path";
import * as fs from "fs";

// Load environment variables from .env file
dotenv.config();

interface CommitInfo {
  message: string;
  date: string;
  author: string;
}

interface RepoCommits {
  [folderName: string]: CommitInfo[];
}

/**
 * Fetches commit messages from the last 7 days for a given repository path.
 * @param {string} repoPath
 * @returns {Promise<CommitInfo[]|null>}
 */
async function getCommits(repoPath: string): Promise<CommitInfo[] | null> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      console.warn(`Warning: ${repoPath} is not a git repository.`);
      return null;
    }

    // Get logs since 7 days ago
    const log = await git.log({ "--since": "7 days ago" });
    return log.all.map((commit) => ({
      message: commit.message,
      date: commit.date,
      author: commit.author_name,
    }));
  } catch (error: any) {
    console.error(`Error reading ${repoPath}:`, error.message);
    return null;
  }
}

/**
 * Uses Gemini to generate a summarized report from the provided commit messages.
 * @param {RepoCommits} repoCommits
 * @param {string} format
 * @returns {Promise<string>}
 */
async function generateReport(repoCommits: RepoCommits): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing in environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  const now = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(now.getDate() - 7);

  let prompt = `You are an assistant helping a developer create a weekly progress report for the period of ${weekAgo.toDateString()} to ${now.toDateString()}.\n`;
  prompt +=
    "I will provide you with commit messages from the last 7 days across several local repository folders.\n\n";

  prompt += `For EACH folder/project, output a block using EXACTLY this plain-text format (no markdown, no HTML, no bullet symbols except dashes):

Project Name      : <folder name>
Completed Last Week:
  - <summarize what was done based on commits, one item per line>
Currently Working On:
  - <infer what is actively being worked on from the most recent commits>
Plan for Next Week:
  -
  -
  -
Bottlenecks / Risks:
  - <note any risks, blockers, or concerns visible from the commits, or "None identified" if none>

---

Rules:
- "Plan for Next Week" must ALWAYS have exactly 3 blank dash lines (  -) and nothing else. Never fill them in.
- Keep language professional and concise.
- Separate each project block with a line of dashes (---).
- Do NOT add any intro text, outro text, or extra commentary outside the blocks.

Here are the commits grouped by folder name:\n\n`;

  for (const [repo, commits] of Object.entries(repoCommits)) {
    prompt += `Folder: ${repo}\n`;
    prompt += commits
      .map((c) => `- [${c.date}] (${c.author}): ${c.message}`)
      .join("\n");
    prompt += "\n\n";
  }

  prompt += "Generate the report now:";

  const result = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
  });
  return result.text || "Could not get result";
}

program
  .name("report-commit-automator")
  .description(
    "Generate a weekly report from git commits across multiple local folders",
  )
  .version("1.0.0")
  .option("-o, --output <path>", "Output file path")
  .argument("[paths...]", "list of paths to local git repository folders")
  .action(async (cliPaths: string[], options: { output?: string }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("Error: GEMINI_API_KEY is not set in .env file.");
      console.log("Please create a .env file with your GEMINI_API_KEY.");
      process.exit(1);
    }

    // Get paths from CLI or from environment variable REPO_PATHS (comma-separated)
    let paths = cliPaths;
    if (paths.length === 0 && process.env.REPO_PATHS) {
      paths = process.env.REPO_PATHS.split(",").map((p) => p.trim());
    }

    if (paths.length === 0) {
      console.error("Error: No repository paths provided.");
      console.log(
        "Provide paths as arguments or set REPO_PATHS in your .env file.",
      );
      process.exit(1);
    }

    console.log("Received paths: ", paths);

    const repoCommits: RepoCommits = {};

    console.log("Reading git commits from the last 7 days...");

    for (const repoPath of paths) {
      const absolutePath = path.resolve(repoPath);
      const folderName = path.basename(absolutePath);

      const commits = await getCommits(absolutePath);

      if (commits && commits.length > 0) {
        repoCommits[folderName] = commits;
        console.log(`- Collected ${commits.length} commits from ${folderName}`);
      } else if (commits) {
        console.log(`- No commits found in the last 7 days for ${folderName}`);
      }
    }

    if (Object.keys(repoCommits).length === 0) {
      console.log(
        "\nNo commits found in any of the provided folders for the last week. Nothing to report.",
      );
      return;
    }

    console.log("\nGenerating weekly report with Gemini...");
    try {
      const report = await generateReport(repoCommits);
      
      if (options.output) {
        const outputPath = path.resolve(options.output);
        fs.writeFileSync(outputPath, report);
        console.log(`\n✅ Report successfully saved to: ${outputPath}`);
      } else {
        console.log("\n========== WEEKLY REPORT ==========");
        console.log(report);
        console.log("\n==================================\n");
      }
    } catch (error: any) {
      console.error("\nError generating report:", error.message);
    }
  });

program.parse();
