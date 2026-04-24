const { GoogleGenerativeAI } = require("@google/generative-ai");
const simpleGit = require("simple-git");
const dotenv = require("dotenv");
const { program } = require("commander");
const path = require("path");

// Load environment variables from .env file
dotenv.config();

/**
 * Fetches commit messages from the last 7 days for a given repository path.
 * @param {string} repoPath 
 * @returns {Promise<string[]|null>}
 */
async function getCommits(repoPath) {
  const git = simpleGit(repoPath);
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      console.warn(`Warning: ${repoPath} is not a git repository.`);
      return null;
    }
    
    // Get logs since 1 week ago
    // We use --since="1 week ago" to filter commits
    const log = await git.log({ "--since": "1 week ago" });
    return log.all.map(commit => commit.message);
  } catch (error) {
    console.error(`Error reading ${repoPath}:`, error.message);
    return null;
  }
}

/**
 * Uses Gemini to generate a summarized report from the provided commit messages.
 * @param {Object} repoCommits 
 * @returns {Promise<string>}
 */
async function generateReport(repoCommits) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const model = genAI.getGenerativeModel({ model: modelName });

  let prompt = "You are an assistant helping a developer create a weekly progress report. I will provide you with commit messages from the last 7 days across several local repository folders. Your task is to organize these into a professional report.\n\n";
  prompt += "Please structure the report as follows:\n";
  prompt += "1. A high-level Executive Summary of the week's progress.\n";
  prompt += "2. A detailed breakdown for each repository folder, summarizing the key features, bug fixes, or improvements made.\n";
  prompt += "3. Keep the tone professional and concise.\n\n";
  prompt += "Here are the commit messages grouped by folder name:\n\n";

  for (const [repo, commits] of Object.entries(repoCommits)) {
    prompt += `### Folder: ${repo}\n`;
    prompt += commits.map(c => `- ${c}`).join("\n");
    prompt += "\n\n";
  }

  prompt += "Generated Report:";

  const result = await model.generateContent(prompt);
  return result.response.text();
}

program
  .name("report-commit-automator")
  .description("Generate a weekly report from git commits across multiple local folders")
  .version("1.0.0")
  .argument("<paths...>", "list of paths to local git repository folders")
  .action(async (paths) => {
    if (!process.env.GEMINI_API_KEY) {
      console.error("Error: GEMINI_API_KEY is not set in .env file.");
      console.log("Please create a .env file with your GEMINI_API_KEY.");
      process.exit(1);
    }

    const repoCommits = {};

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
      console.log("\nNo commits found in any of the provided folders for the last week. Nothing to report.");
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
    } catch (error) {
      console.error("\nError generating report:", error.message);
    }
  });

program.parse();
