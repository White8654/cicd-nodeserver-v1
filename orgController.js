const { CreateTableCommand, DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
const { PutCommand, GetCommand, UpdateCommand, DeleteCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { ddbDocClient } = require("./dbconfig");

// Create a table if it doesn't exist
const createTableIfNotExists = async (tableName) => {
  try {
    await ddbDocClient.send(
      new CreateTableCommand({
        TableName: tableName,
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "N" }],
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
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
    const { Table } = await ddbDocClient.send(new DescribeTableCommand({ TableName: tableName }));
    tableActive = Table.TableStatus === "ACTIVE";
    if (!tableActive) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second before checking again
    }
  }
};

// Add an item
const addItem = async (tableName, item) => {
  await createTableIfNotExists(tableName);
  const params = {
    TableName: tableName,
    Item: {
      id: Math.floor(Math.random() * 10000),
      ...item,
      LastUpdated: new Date().toISOString(),
    },
  };
  await ddbDocClient.send(new PutCommand(params));
};

// Get all items
const getItems = async (tableName) => {
  try {
    const data = await ddbDocClient.send(new ScanCommand({ TableName: tableName }));
    return data.Items || [];
  } catch (error) {
    if (error.name === "ResourceNotFoundException") {
      return [];
    }
    throw error;
  }
};

// Get an item by ID
const getItem = async (tableName, id) => {
  const data = await ddbDocClient.send(new GetCommand({
    TableName: tableName,
    Key: { id },
  }));
  if (!data.Item) {
    throw new Error(`Item with id ${id} not found in table ${tableName}.`);
  }
  return data.Item;
};

// Update an item

const updateItem = async (tableName, id, updates) => {
  // Exclude 'id' and 'LastUpdated' fields from updates
  const allowedUpdates = Object.keys(updates).reduce((acc, key) => {
    if (key !== 'id' && key !== 'LastUpdated') {
      acc[key] = updates[key];
    }
    return acc;
  }, {});

  // Build the update expression
  const updateExpression = Object.keys(allowedUpdates)
    .map((key, index) => `#field${index} = :value${index}`)
    .join(", ");

  const expressionAttributeNames = Object.keys(allowedUpdates).reduce((acc, key, index) => {
    acc[`#field${index}`] = key;
    return acc;
  }, {});

  const expressionAttributeValues = Object.keys(allowedUpdates).reduce((acc, key, index) => {
    acc[`:value${index}`] = allowedUpdates[key];
    return acc;
  }, {});

  const params = {
    TableName: tableName,
    Key: { id },
    UpdateExpression: `set ${updateExpression}, LastUpdated = :lastUpdatedVal`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: {
      ...expressionAttributeValues,
      ":lastUpdatedVal": new Date().toISOString(),
    },
  };

  await ddbDocClient.send(new UpdateCommand(params));
};

// Delete an item
const deleteItem = async (tableName, id) => {
  await ddbDocClient.send(new DeleteCommand({
    TableName: tableName,
    Key: { id },
  }));
};

module.exports = { addItem, getItems, getItem, updateItem, deleteItem };