const { CreateTableCommand, DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
const { PutCommand, GetCommand, ScanCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const { ddbDocClient } = require("./dbconfig");

const REGISTRY_TABLE_NAME = "TableRegistry";

// Helper function to create table if it doesn't exist
const createTableIfNotExists = async (tableName, tableDefinition) => {
  try {
    await ddbDocClient.send(
      new CreateTableCommand({
        TableName: tableName,
        KeySchema: tableDefinition.KeySchema,
        AttributeDefinitions: tableDefinition.AttributeDefinitions,
        ProvisionedThroughput: tableDefinition.ProvisionedThroughput
      })
    );
    console.log(`Table ${tableName} created successfully.`);
    
    // Wait for the table to be active
    await waitForTableToBeActive(tableName);
  } catch (error) {
    if (error.name === "ResourceInUseException") {
      console.log(`Table ${tableName} already exists.`);
    } else {
      throw error;
    }
  }
};

// Helper function to wait for a table to become active
const waitForTableToBeActive = async (tableName) => {
  let tableActive = false;
  while (!tableActive) {
    try {
      const { Table } = await ddbDocClient.send(
        new DescribeTableCommand({ TableName: tableName })
      );
      tableActive = Table.TableStatus === "ACTIVE";
      if (!tableActive) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Error checking table status: ${error}`);
      throw error;
    }
  }
};

// Initialize the registry table
const initializeRegistry = async () => {
  try {
    await createTableIfNotExists(REGISTRY_TABLE_NAME, {
      KeySchema: [
        { AttributeName: "tableName", KeyType: "HASH" },
        { AttributeName: "alias", KeyType: "RANGE" }
      ],
      AttributeDefinitions: [
        { AttributeName: "tableName", AttributeType: "S" },
        { AttributeName: "alias", AttributeType: "S" }
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5,
      }
    });
  } catch (error) {
    console.error("Error initializing registry:", error);
    throw error;
  }
};

const createDynamoDBTable = async (tableName, fields) => {
  const keySchema = [{ AttributeName: "id", KeyType: "HASH" }];
  const attributeDefinitions = [{ AttributeName: "id", AttributeType: "N" }];

  const params = {
    TableName: tableName,
    KeySchema: keySchema,
    AttributeDefinitions: attributeDefinitions,
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    }
  };

  try {
    await ddbDocClient.send(new CreateTableCommand(params));
    console.log(`Table ${tableName} created successfully.`);
    await waitForTableToBeActive(tableName);
  } catch (error) {
    if (error.name === "ResourceInUseException") {
      console.log(`Table ${tableName} already exists.`);
    } else {
      throw error;
    }
  }
};

// Register a table schema
const registerTableSchema = async (tableName, alias, fields) => {
  const params = {
    TableName: REGISTRY_TABLE_NAME,
    Item: {
      tableName,
      alias,
      fields,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    }
  };

  try {
    // Register the schema
    await ddbDocClient.send(new PutCommand(params));
    console.log(`Schema registered for table ${tableName} with alias ${alias}`);

    // Create the actual DynamoDB table
    await createDynamoDBTable(tableName, fields);
  } catch (error) {
    console.error(`Error registering schema for table ${tableName}:`, error);
    throw error;
  }
};


// Get table schema by table name or alias
const getTableSchema = async (identifier) => {
  try {
    const params = {
      TableName: REGISTRY_TABLE_NAME,
      FilterExpression: "tableName = :tableName OR alias = :alias",
      ExpressionAttributeValues: {
        ":tableName": identifier,
        ":alias": identifier
      }
    };

    const result = await ddbDocClient.send(new ScanCommand(params));
    if (!result.Items || result.Items.length === 0) {
      throw new Error(`No schema found for identifier: ${identifier}`);
    }
    return result.Items[0];
  } catch (error) {
    console.error(`Error getting schema for ${identifier}:`, error);
    throw error;
  }
};

// List all registered tables and their schemas
const listTableSchemas = async () => {
  try {
    const result = await ddbDocClient.send(new ScanCommand({
      TableName: REGISTRY_TABLE_NAME
    }));
    return result.Items || [];
  } catch (error) {
    console.error("Error listing table schemas:", error);
    throw error;
  }
};

// Update table schema
const updateTableSchema = async (tableName, updates) => {
  try {
    const existingSchema = await getTableSchema(tableName);
    const params = {
      TableName: REGISTRY_TABLE_NAME,
      Item: {
        ...existingSchema,
        ...updates,
        lastUpdated: new Date().toISOString()
      }
    };
    await ddbDocClient.send(new PutCommand(params));
  } catch (error) {
    console.error(`Error updating schema for table ${tableName}:`, error);
    throw error;
  }
};

// Delete table schema
const deleteTableSchema = async (tableName) => {
  try {
    await ddbDocClient.send(new DeleteCommand({
      TableName: REGISTRY_TABLE_NAME,
      Key: {
        tableName,

      }
    }));
  } catch (error) {
    console.error(`Error deleting schema for table ${tableName}:`, error);
    throw error;
  }
};



module.exports = {
  initializeRegistry,
  registerTableSchema,
  getTableSchema,
  listTableSchemas,
  updateTableSchema,
  deleteTableSchema
};