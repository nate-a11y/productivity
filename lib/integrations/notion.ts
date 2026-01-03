// Notion Integration
// Docs: https://developers.notion.com/docs/authorization

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

export const NOTION_CONFIG = {
  clientId: process.env.NOTION_CLIENT_ID!,
  clientSecret: process.env.NOTION_CLIENT_SECRET!,
  redirectUri: `${APP_URL}/api/integrations/notion/callback`,
  authUrl: "https://api.notion.com/v1/oauth/authorize",
  tokenUrl: "https://api.notion.com/v1/oauth/token",
  apiVersion: "2022-06-28",
};

export function getNotionAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: NOTION_CONFIG.clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: NOTION_CONFIG.redirectUri,
    state,
  });

  return `${NOTION_CONFIG.authUrl}?${params.toString()}`;
}

export interface NotionTokenResponse {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_icon: string | null;
  owner: {
    type: string;
    user?: {
      id: string;
      name: string;
      avatar_url: string | null;
      type: string;
      person?: { email: string };
    };
  };
  duplicated_template_id: string | null;
  request_id: string;
}

export async function exchangeCodeForToken(code: string): Promise<NotionTokenResponse> {
  const credentials = Buffer.from(
    `${NOTION_CONFIG.clientId}:${NOTION_CONFIG.clientSecret}`
  ).toString("base64");

  const response = await fetch(NOTION_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: NOTION_CONFIG.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code: ${error}`);
  }

  return response.json();
}

// Notion API client for making requests
export async function notionRequest(
  accessToken: string,
  endpoint: string,
  method: string = "GET",
  body?: object
) {
  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_CONFIG.apiVersion,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error: ${error}`);
  }

  return response.json();
}

// Search for databases the user has access to
export async function searchDatabases(accessToken: string) {
  return notionRequest(accessToken, "/search", "POST", {
    filter: { property: "object", value: "database" },
  });
}

// Get a specific database
export async function getDatabase(accessToken: string, databaseId: string) {
  return notionRequest(accessToken, `/databases/${databaseId}`);
}

// Create a page (task) in a database
export async function createPage(
  accessToken: string,
  databaseId: string,
  properties: object
) {
  return notionRequest(accessToken, "/pages", "POST", {
    parent: { database_id: databaseId },
    properties,
  });
}

// Update a page
export async function updatePage(
  accessToken: string,
  pageId: string,
  properties: object
) {
  return notionRequest(accessToken, `/pages/${pageId}`, "PATCH", { properties });
}

// Query a database
export async function queryDatabase(
  accessToken: string,
  databaseId: string,
  filter?: object,
  sorts?: object[]
) {
  return notionRequest(accessToken, `/databases/${databaseId}/query`, "POST", {
    filter,
    sorts,
  });
}
