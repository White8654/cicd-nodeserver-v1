// authController.js

// Function to handle authentication request
const authenticateUser = async (alias) => {
    const fetch = (await import("node-fetch")).default; // Dynamic import of node-fetch
  
    const url = `https://2349-210-89-54-148.ngrok-free.app/api/v1/getauthtoken?url=https://test.salesforce.com&alias=${alias}`;
  
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
  
      if (response.ok) {
        const data = await response.json();
        return data;
      } else {
        throw new Error(`Failed to authenticate: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error during authentication:", error.message);
      throw new Error("Authentication failed.");
    }
  };
  
  module.exports = { authenticateUser };