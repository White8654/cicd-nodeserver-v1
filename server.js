const {  DeleteTableCommand,ListTablesCommand } = require("@aws-sdk/client-dynamodb");
const { ScanCommand, UpdateCommand, PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { ddbDocClient } = require("./dbconfig");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const {
  addItem, getItems, getItem, updateItem, deleteItem
} = require("./orgController");
const { authenticateUser } = require("./authController");
const {
  initializeRegistry,
  registerTableSchema,
  getTableSchema,
  listTableSchemas,
  updateTableSchema,
  deleteTableSchema
} = require("./tableRegistryController");
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { spawn } = require('child_process');


const app = express();
app.use(bodyParser.json());

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
}));



// Function to check SF CLI version
async function checkSfCliVersion() {
  try {
      const { stdout, stderr } = await execPromise('sf -v');
      if (stderr) {
          throw new Error('Error checking SF CLI version');
      }
      return stdout.trim();
  } catch (error) {
      throw new Error('Salesforce CLI is not installed or accessible: ' + error.message);
  }
}
app.post('/device-code', async (req, res) => {
  try {
      const { alias } = req.body;
      
      if (!alias) {
          return res.status(400).json({ error: 'Alias is required' });
      }

      // First, check SF CLI version
      const versionInfo = await checkSfCliVersion();
      console.log('Salesforce CLI Version:', versionInfo);

      // Start the SF CLI process
      const childProcess = spawn('sf', ['org', 'login', 'device', '--instance-url', 'https://test.salesforce.com/', '--alias', alias]);

      let output = '';

      childProcess.stdout.on('data', (data) => {
          output += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
          output += data.toString();
      });

      // Set timeout to kill the process after 5 seconds
      setTimeout(() => {
          if (!childProcess.killed) {
              childProcess.kill();
              console.log('Process killed after timeout');
          }
      }, 2000);

      childProcess.on('close', () => {
          //console.log('Raw output:', output); // For debugging

          try {
              // Extract device code and verification URL using plain string search
              const deviceCodeIndex = output.indexOf('Enter') + 6; // Find "Enter" and move forward to capture code
              const deviceCodeEnd = output.indexOf('device code');
              const verificationUrlIndex = output.indexOf('URL:') + 5;

              const deviceCode = output.substring(deviceCodeIndex, deviceCodeEnd).trim();
              const verificationUrl = output.substring(verificationUrlIndex).split('\n')[0].trim();

              // Validate extraction
              if (deviceCode && verificationUrl) {
                  return res.status(200).json({
                      success: true,
                      sfCliVersion: versionInfo,
                      deviceCode,
                      verificationUrl,
                     
                  });
              } else {
                  throw new Error('Device code or verification URL not found in the output');
              }
          } catch (error) {
             // console.error('Error parsing output:', error);
              res.status(500).json({
                  success: false,
                  error: 'Could not extract device code or verification URL',
                  fullOutput: output
              });
          }
      });

      childProcess.on('error', (error) => {
          res.status(500).json({
              success: false,
              error: error.message,
              fullOutput: output
          });
      });

  } catch (error) {
      console.error('Error:', error);
      res.status(500).json({
          success: false,
          error: error.message,
          details: error.stderr || error.stdout
      });
  }
});




const REGISTRY_TABLE_NAME = "TableRegistry";

// Helper function to rename field in a table
const renameFieldInTableItems = async (tableName, oldFieldName, newFieldName) => {
  try {
    // Get all items from the table
    const data = await ddbDocClient.send(new ScanCommand({ TableName: tableName }));
    const items = data.Items || [];

    // Iterate through each item and update the field name
    for (const item of items) {
      // Copy existing item and rename the field
      const updatedItem = { ...item };
      if (item[oldFieldName] !== undefined) {
        updatedItem[newFieldName] = item[oldFieldName];
        delete updatedItem[oldFieldName];

        // Update the item in the DynamoDB table
        await ddbDocClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { id: item.id }, // Assuming `id` is the primary key
            UpdateExpression: `SET #newFieldName = :newValue REMOVE #oldFieldName`,
            ExpressionAttributeNames: {
              "#newFieldName": newFieldName,
              "#oldFieldName": oldFieldName,
            },
            ExpressionAttributeValues: {
              ":newValue": item[oldFieldName],
            },
          })
        );
      }
    }
    console.log(`Field '${oldFieldName}' renamed to '${newFieldName}' in all items of table ${tableName}`);
  } catch (error) {
    console.error(`Error renaming field in table ${tableName}:`, error);
    throw error;
  }
};

// Function to rename field in the TableRegistry schema
const renameFieldInRegistrySchema = async (tableName, oldFieldName, newFieldName) => {
  try {
    // Retrieve the schema for the table from the TableRegistry
    const { Item: schema } = await ddbDocClient.send(
      new GetCommand({
        TableName: "TableRegistry",
        Key: { tableName },
      })
    );

    if (!schema) {
      throw new Error(`No schema found for table ${tableName}`);
    }

    // Check if the old field name exists in the schema
    if (!schema.fields[oldFieldName]) {
      throw new Error(`Field '${oldFieldName}' does not exist in schema for table ${tableName}`);
    }

    // Rename the field in the schema
    schema.fields[newFieldName] = { ...schema.fields[oldFieldName] };
    delete schema.fields[oldFieldName];

    // Update the schema in the TableRegistry
    await ddbDocClient.send(
      new PutCommand({
        TableName: "TableRegistry",
        Item: {
          ...schema,
          lastUpdated: new Date().toISOString(),
        },
      })
    );
    console.log(`Field '${oldFieldName}' renamed to '${newFieldName}' in schema of table ${tableName}`);
  } catch (error) {
    console.error(`Error updating schema in TableRegistry for table ${tableName}:`, error);
    throw error;
  }
};

// Standalone API route to rename field in both items and schema

app.get('/health', (req, res) => {
  res.status(200).send('server ok hai bhai !!');
});

app.put("/rename-field", async (req, res) => {
  const { tableName, oldFieldName, newFieldName } = req.body;

  try {
    // Step 1: Rename field in all items of the table
    await renameFieldInTableItems(tableName, oldFieldName, newFieldName);

    // Step 2: Rename field in the schema of the TableRegistry
    await renameFieldInRegistrySchema(tableName, oldFieldName, newFieldName);

    res.status(200).json({ message: `Field '${oldFieldName}' renamed to '${newFieldName}' in table '${tableName}' and its schema.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
















(async () => {
  try {
    await initializeRegistry();
    console.log("Table registry initialized successfully");
  } catch (error) {
    console.error("Failed to initialize table registry:", error);
  }
})();




// Register a new table schema
app.post("/schema", async (req, res) => {
  try {
    const { tableName, alias, fields } = req.body;
    await registerTableSchema(tableName, alias, fields);
    res.status(201).json({ message: "Schema registered successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




// Get schema by table name or alias
app.get("/schema/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const schema = await getTableSchema(identifier);
    res.status(200).json(schema);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});




// List all registered schemas
app.get("/schemas", async (req, res) => {
  try {
    const schemas = await listTableSchemas();
    const filteredSchemas = schemas.filter(schema => schema.tableName !== "TableRegistry");
    res.status(200).json(filteredSchemas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




app.post('/get-device-code', (req, res) => {
  const alias = req.body.alias;

  if (!alias) {
      return res.status(400).json({ error: 'Alias is required' });
  }

  // Command to generate the device code using Salesforce CLI
  const command = `sf org login device --instance-url https://test.salesforce.com/ --alias ${alias}`;

  exec(command, (error, stdout, stderr) => {
      if (error) {
          console.error(`Error executing command: ${stderr}`);
          return res.status(500).json({ error: 'Failed to generate device code' });
      }

      // Process and return the response
      res.json({ deviceCodeOutput: stdout.trim() });
  });
});






// Update schema
app.put("/schema/:tableName", async (req, res) => {
  try {
    const { tableName } = req.params;
    const updates = req.body;
    await updateTableSchema(tableName, updates);
    res.status(200).json({ message: "Schema updated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete schema
app.delete("/schema/:tableName", async (req, res) => {
  try {
    const { tableName} = req.params;
    await deleteTableSchema(tableName);
    res.status(200).json({ message: "Schema deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




// Route to authenticate a user
app.post("/authenticate", async (req, res) => {
  try {
    const { alias } = req.body;
    const authData = await authenticateUser(alias);
    res.status(200).json(authData);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Route to list all tables
app.get("/tables", async (req, res) => {
  try {
    const tables = await listTables();
    const filteredTables = tables.filter(tableName => tableName !== "TableRegistry");
    res.status(200).json(filteredTables);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Route to drop a table
app.delete("/table/:tableName", async (req, res) => {
  try {
    const { tableName } = req.params;
    await dropTable(tableName);
    res.status(200).send(`Table ${tableName} deleted successfully.`);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Route to rename a table
app.put("/table/rename", async (req, res) => {
  try {
    const { oldTableName, newTableName } = req.body;
    await renameTable(oldTableName, newTableName);
    res.status(200).send(`Table ${oldTableName} renamed to ${newTableName}.`);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Helper functions

// Function to list all tables
const listTables = async () => {
  const data = await ddbDocClient.send(new ListTablesCommand({}));
  return data.TableNames || [];
};

// Function to drop a table
const dropTable = async (tableName) => {
  try {
    await ddbDocClient.send(new DeleteTableCommand({ TableName: tableName }));
    console.log(`Table ${tableName} deleted successfully.`);
  } catch (error) {
    if (error.name === "ResourceNotFoundException") {
      throw new Error(`Table ${tableName} does not exist.`);
    } else {
      throw error;
    }
  }
};

// Function to rename a table (create new, copy data, delete old)
const renameTable = async (oldTableName, newTableName) => {
  try {
    // Check if new table already exists
    const existingTables = await listTables();
    if (existingTables.includes(newTableName)) {
      throw new Error(`Table ${newTableName} already exists.`);
    }

    // Step 1: Create new table
    await createTableIfNotExists(newTableName);

    // Step 2: Copy data from old table to new table
    const items = await getItems(oldTableName);
    for (const item of items) {
      await addItem(newTableName, item);
    }

    // Step 3: Drop the old table
    await dropTable(oldTableName);

    console.log(`Table ${oldTableName} renamed to ${newTableName} successfully.`);
  } catch (error) {
    throw error;
  }
};

// Route to add an item
app.post("/item", async (req, res) => {
  try {
    const { tableName, ...itemData } = req.body;
    await addItem(tableName, itemData);
    res.status(200).json({ message: "Schema updated successfully" });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Route to get all items
app.get("/items/:tableName", async (req, res) => {
  try {
    const { tableName } = req.params;
    const items = await getItems(tableName);
    res.status(200).json(items);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Route to get a specific item by ID
app.get("/item/:tableName/:id", async (req, res) => {
  try {
    const { tableName, id } = req.params;
    const item = await getItem(tableName, parseInt(id));
    res.status(200).json(item);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Route to update an item
app.put("/item/:tableName/:id", async (req, res) => {
  try {
    const { tableName, id } = req.params;
    const updates = req.body;
    console.log(updates);
    await updateItem(tableName, parseInt(id), updates);
    res.status(200).json({ message: "Item updated successfully" });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Route to delete an item
app.delete("/item/:tableName/:id", async (req, res) => {
  try {
    const { tableName, id } = req.params;
    await deleteItem(tableName, parseInt(id));
    res.status(200).json({ message: "Item deleted successfully" });
  } catch (error) {
    res.status(500).send(error.message);
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});