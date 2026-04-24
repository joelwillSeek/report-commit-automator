import { GoogleGenerativeAI } from "@google/generative-ai";
import { simpleGit, SimpleGit } from "simple-git";
import * as dotenv from "dotenv";
import { program } from "commander";
import * as path from "path";

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
 * @returns {Promise<string>}
 */
async function generateReport(repoCommits: RepoCommits): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing in environment variables.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const model = genAI.getGenerativeModel({ model: modelName });

  const now = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(now.getDate() - 7);

  let prompt = `You are an assistant helping a developer create a weekly progress report for the period of ${weekAgo.toDateString()} to ${now.toDateString()}.\n`;
  prompt +=
    "I will provide you with commit messages from the last 7 days across several local repository folders, including dates and authors. Your task is to organize these into a professional report.\n\n";
  prompt += "Please structure the report as follows:\n";
  prompt += "1. A high-level Executive Summary of the week's progress.\n";
  prompt +=
    "2. A detailed breakdown for each repository folder, summarizing the key features, bug fixes, or improvements made. Organize these chronologically if possible.\n";
  prompt += "3. Mention significant contributions or themes observed.\n";
  prompt += "4. Keep the tone professional and concise.\n\n";
  prompt += "Here are the commits grouped by folder name:\n\n";

  for (const [repo, commits] of Object.entries(repoCommits)) {
    prompt += `### Folder: ${repo}\n`;
    prompt += commits
      .map((c) => `- [${c.date}] (${c.author}): ${c.message}`)
      .join("\n");
    prompt += "\n\n";
  }

  prompt += "Generated Report:";

  const result = await model.generateContent(prompt);
  return result.response.text();
}

program
  .name("report-commit-automator")
  .description(
    "Generate a weekly report from git commits across multiple local folders",
  )
  .version("1.0.0")
  .argument("<paths...>", "list of paths to local git repository folders")
  .action(async (paths: string[]) => {
    if (!process.env.GEMINI_API_KEY) {
      console.error("Error: GEMINI_API_KEY is not set in .env file.");
      console.log("Please create a .env file with your GEMINI_API_KEY.");
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

    console.log("\nGenerating professional report with Gemini...");
    try {
      const report = await generateReport(repoCommits);
      console.log("\n==========================================");
      console.log("             WEEKLY REPORT               ");
      console.log("==========================================\n");
      console.log(report);
      console.log("\n==========================================\n");
    } catch (error: any) {
      console.error("\nError generating report:", error.message);
    }
  });

program.parse();
