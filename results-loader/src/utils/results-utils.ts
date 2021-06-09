import ClientOAuth2 from "client-oauth2";
import { TokenServiceClient, EnvironmentName, ResourceType, Resource, Credentials } from "@concord-consortium/token-service";

const PORTAL_AUTH_PATH = "/auth/oauth_authorize";

const getURLParam = (name: string) => {
  const url = (self || window).location.href;
  name = name.replace(/[[]]/g, "\\$&");
  const regex = new RegExp(`[#?&]${name}(=([^&#]*)|&|#|$)`);
  const results = regex.exec(url);
  if (!results) return null;
  return decodeURIComponent(results[2].replace(/\+/g, " "));
};

export const authorizeInPortal = (portalUrl: string, oauthClientName: string) => {
  const portalAuth = new ClientOAuth2({
    clientId: oauthClientName,
    redirectUri: window.location.origin + window.location.pathname + window.location.search,
    authorizationUri: `${portalUrl}${PORTAL_AUTH_PATH}`
  });
  // Redirect
  window.location.href = portalAuth.token.getUri();
};

export const readPortalAccessToken = (portalUrl: string, oauthClientName: string) => {
  const accessToken = getURLParam("access_token");
  const error = getURLParam("error");
  if (!accessToken && !error) {
    authorizeInPortal(portalUrl, oauthClientName);
  } else {
    // c.f. https://stackoverflow.com/questions/22753052/remove-url-parameters-without-refreshing-page
    if (window.history?.pushState !== undefined) {
      // if pushstate exists, add a new state to the history, this changes the url without reloading the page
      window.history.pushState({}, document.title, window.location.pathname);
    }
  }
  return {accessToken: accessToken || "", error};
};

export const getFirebaseJwt = (portalUrl: string, portalAccessToken: string, firebaseAppName: string): Promise<string> => {
  const authHeader = { Authorization: `Bearer ${portalAccessToken}` };
  const firebaseTokenGettingUrl = `${portalUrl}/api/v1/jwt/firebase?firebase_app=${firebaseAppName}`;
  return fetch(firebaseTokenGettingUrl, { headers: authHeader })
    .then(response => response.json())
    .then(json => json.token);
};

interface IGetCredentials {
  resource: Resource;
  firebaseJwt?: string;
  tokenServiceEnv: EnvironmentName;
}
export const getCredentials = async ({resource, firebaseJwt,
  tokenServiceEnv}: IGetCredentials): Promise<Credentials> => {

  // The jwt will be ignored if there is a readWriteToken on the resource
  const client = new TokenServiceClient({ env: tokenServiceEnv, jwt: firebaseJwt });
  const readWriteToken = client.getReadWriteToken(resource) || "";

  return readWriteToken ? await client.getCredentials(resource.id, readWriteToken) :  await client.getCredentials(resource.id);
};

export const listResources = async (firebaseJwt: string, amOwner: boolean,
  tokenServiceEnv: EnvironmentName, resourceType: ResourceType) => {
  const client = new TokenServiceClient({ jwt: firebaseJwt, env: tokenServiceEnv });
  return client.listResources({
    type: resourceType,
    tool: "example-app", // TODO: this needs to be set to valid string based on the app that created the resource
    amOwner: amOwner ? "true" : "false"
  });
};
