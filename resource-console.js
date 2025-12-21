#!/usr/bin/env node

/**
 * AWS Resource Management Console
 * 
 * This script provides a command-line interface to manage all AWS resources
 * used by the Catfish application. It can list, create, update, and delete
 * resources including VPC, RDS, Lambda, S3, DynamoDB, Cognito, etc.
 * 
 * Usage:
 *   node resource-console.js list [resource-type]
 *   node resource-console.js create [resource-type] [options]
 *   node resource-console.js update [resource-type] [options]
 *   node resource-console.js delete [resource-type] [options]
 * 
 * Examples:
 *   node resource-console.js list all
 *   node resource-console.js list vpc
 *   node resource-console.js create vpc --name catfish-vpc --cidr 10.0.0.0/16
 *   node resource-console.js create rds --instance-id catfish-db --engine postgres
 *   node resource-console.js delete vpc --vpc-id vpc-123456
 */

const AWS = require('aws-sdk');
const readline = require('readline');
const { v4: uuidv4 } = require('uuid');

// Configure AWS SDK
const region = process.env.AWS_REGION || 'us-east-1';
const profile = process.env.AWS_PROFILE || 'default';

// Initialize AWS clients
const ec2 = new AWS.EC2({ region, profile });
const rds = new AWS.RDS({ region, profile });
const lambda = new AWS.Lambda({ region, profile });
const s3 = new AWS.S3({ region, profile });
const dynamodb = new AWS.DynamoDB({ region, profile });
const cognito = new AWS.CognitoIdentityServiceProvider({ region, profile });
const apigateway = new AWS.APIGateway({ region, profile });
const secretsmanager = new AWS.SecretsManager({ region, profile });
const ssm = new AWS.SSM({ region, profile });
const cloudformation = new AWS.CloudFormation({ region, profile });
const logs = new AWS.CloudWatchLogs({ region, profile });

const serviceName = 'image-analysis';
const stage = process.env.STAGE || 'dev';

// Helper function to parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const resourceType = args[1];
  const options = {};

  for (let i = 2; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      const value = args[i + 1];
      options[key] = value;
      i++;
    }
  }

  return { command, resourceType, options };
}

// Prompt for user confirmation
function promptConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// LIST OPERATIONS
async function listAll() {
  console.log('\n=== Listing All AWS Resources ===\n');
  
  await listVPCs();
  await listRDSInstances();
  await listLambdaFunctions();
  await listS3Buckets();
  await listDynamoDBTables();
  await listCognitoUserPools();
  await listAPIGateways();
  await listSecrets({});
  await listSSMParameters();
  await listCloudFormationStacks();
  await listLogGroups();
}

async function listVPCs() {
  try {
    console.log('--- VPCs ---');
    const result = await ec2.describeVpcs().promise();
    const vpcs = result.Vpcs || [];
    
    if (vpcs.length === 0) {
      console.log('  No VPCs found\n');
      return;
    }

    for (const vpc of vpcs) {
      console.log(`  VPC ID: ${vpc.VpcId}`);
      console.log(`    CIDR: ${vpc.CidrBlock}`);
      console.log(`    State: ${vpc.State}`);
      console.log(`    Tags: ${JSON.stringify(vpc.Tags || [])}`);
      
      // Get subnets
      const subnets = await ec2.describeSubnets({ Filters: [{ Name: 'vpc-id', Values: [vpc.VpcId] }] }).promise();
      console.log(`    Subnets: ${(subnets.Subnets || []).map(s => s.SubnetId).join(', ') || 'None'}`);
      console.log('');
    }
  } catch (error) {
    console.error(`  Error listing VPCs: ${error.message}\n`);
  }
}

async function listRDSInstances() {
  try {
    console.log('--- RDS Instances ---');
    const result = await rds.describeDBInstances().promise();
    const instances = result.DBInstances || [];
    
    if (instances.length === 0) {
      console.log('  No RDS instances found\n');
      return;
    }

    for (const instance of instances) {
      console.log(`  DB Instance ID: ${instance.DBInstanceIdentifier}`);
      console.log(`    Engine: ${instance.Engine} ${instance.EngineVersion}`);
      console.log(`    Status: ${instance.DBInstanceStatus}`);
      console.log(`    Endpoint: ${instance.Endpoint?.Address || 'N/A'}:${instance.Endpoint?.Port || 'N/A'}`);
      console.log(`    VPC: ${instance.DBSubnetGroup?.VpcId || 'N/A'}`);
      console.log(`    Storage: ${instance.AllocatedStorage}GB`);
      console.log(`    Instance Class: ${instance.DBInstanceClass}`);
      console.log('');
    }
  } catch (error) {
    console.error(`  Error listing RDS instances: ${error.message}\n`);
  }
}

async function listLambdaFunctions() {
  try {
    console.log('--- Lambda Functions ---');
    const result = await lambda.listFunctions().promise();
    const functions = result.Functions || [];
    const catfishFunctions = functions.filter(f => f.FunctionName.includes(serviceName));
    
    if (catfishFunctions.length === 0) {
      console.log(`  No Lambda functions found for ${serviceName}\n`);
      return;
    }

    for (const func of catfishFunctions) {
      console.log(`  Function: ${func.FunctionName}`);
      console.log(`    Runtime: ${func.Runtime}`);
      console.log(`    Memory: ${func.MemorySize}MB`);
      console.log(`    Timeout: ${func.Timeout}s`);
      console.log(`    Last Modified: ${func.LastModified}`);
      console.log('');
    }
  } catch (error) {
    console.error(`  Error listing Lambda functions: ${error.message}\n`);
  }
}

async function listS3Buckets() {
  try {
    console.log('--- S3 Buckets ---');
    const result = await s3.listBuckets().promise();
    const buckets = result.Buckets || [];
    const catfishBuckets = buckets.filter(b => b.Name.includes(serviceName) || b.Name.includes('catfish'));
    
    if (catfishBuckets.length === 0) {
      console.log(`  No S3 buckets found for ${serviceName}\n`);
      return;
    }

    for (const bucket of catfishBuckets) {
      console.log(`  Bucket: ${bucket.Name}`);
      console.log(`    Created: ${bucket.CreationDate}`);
      
      try {
        const location = await s3.getBucketLocation({ Bucket: bucket.Name }).promise();
        console.log(`    Region: ${location.LocationConstraint || region}`);
      } catch (e) {
        // Ignore location errors
      }
      console.log('');
    }
  } catch (error) {
    console.error(`  Error listing S3 buckets: ${error.message}\n`);
  }
}

async function listDynamoDBTables() {
  try {
    console.log('--- DynamoDB Tables ---');
    const result = await dynamodb.listTables().promise();
    const tables = result.TableNames || [];
    const catfishTables = tables.filter(t => t.includes(serviceName) || t.includes('catfish'));
    
    if (catfishTables.length === 0) {
      console.log(`  No DynamoDB tables found for ${serviceName}\n`);
      return;
    }

    for (const tableName of catfishTables) {
      try {
        const table = await dynamodb.describeTable({ TableName: tableName }).promise();
        const tableDesc = table.Table;
        console.log(`  Table: ${tableName}`);
        console.log(`    Status: ${tableDesc.TableStatus}`);
        console.log(`    Item Count: ${tableDesc.ItemCount || 0}`);
        console.log(`    Billing Mode: ${tableDesc.BillingModeSummary?.BillingMode || 'N/A'}`);
        console.log('');
      } catch (e) {
        console.log(`  Table: ${tableName} (Error getting details: ${e.message})`);
      }
    }
  } catch (error) {
    console.error(`  Error listing DynamoDB tables: ${error.message}\n`);
  }
}

async function listCognitoUserPools() {
  try {
    console.log('--- Cognito User Pools ---');
    const result = await cognito.listUserPools({ MaxResults: 60 }).promise();
    const pools = result.UserPools || [];
    const catfishPools = pools.filter(p => p.Name.includes(serviceName) || p.Name.includes('catfish'));
    
    if (catfishPools.length === 0) {
      console.log(`  No Cognito User Pools found for ${serviceName}\n`);
      return;
    }

    for (const pool of catfishPools) {
      console.log(`  User Pool: ${pool.Name} (${pool.Id})`);
      console.log(`    Created: ${new Date(pool.CreationDate).toISOString()}`);
      console.log(`    Last Modified: ${new Date(pool.LastModifiedDate).toISOString()}`);
      console.log('');
    }
  } catch (error) {
    console.error(`  Error listing Cognito User Pools: ${error.message}\n`);
  }
}

async function listAPIGateways() {
  try {
    console.log('--- API Gateways ---');
    const result = await apigateway.getRestApis({ limit: 500 }).promise();
    const apis = result.items || [];
    const catfishApis = apis.filter(a => a.name.includes(serviceName) || a.name.includes('catfish'));
    
    if (catfishApis.length === 0) {
      console.log(`  No API Gateways found for ${serviceName}\n`);
      return;
    }

    for (const api of catfishApis) {
      console.log(`  API: ${api.name} (${api.id})`);
      console.log(`    Created: ${new Date(api.createdDate).toISOString()}`);
      console.log(`    Description: ${api.description || 'N/A'}`);
      console.log('');
    }
  } catch (error) {
    console.error(`  Error listing API Gateways: ${error.message}\n`);
  }
}

async function listSecrets(options = {}) {
  try {
    const showAll = options.all || false;
    const showDetails = options.details !== false; // Default to true
    
    console.log('--- Secrets Manager Secrets ---');
    
    let allSecrets = [];
    let nextToken = null;
    
    // Paginate through all secrets
    do {
      const params = { MaxResults: 100 };
      if (nextToken) params.NextToken = nextToken;
      
      const result = await secretsmanager.listSecrets(params).promise();
      allSecrets = allSecrets.concat(result.SecretList || []);
      nextToken = result.NextToken;
    } while (nextToken);
    
    const secrets = showAll ? allSecrets : allSecrets.filter(s => s.Name.includes('catfish') || s.Name.includes(serviceName));
    
    if (secrets.length === 0) {
      console.log(`  No secrets found${showAll ? '' : ' for catfish'}\n`);
      return;
    }

    console.log(`  Found ${secrets.length} secret(s)\n`);

    for (const secret of secrets) {
      console.log(`  Secret: ${secret.Name}`);
      console.log(`    ARN: ${secret.ARN}`);
      console.log(`    Description: ${secret.Description || 'N/A'}`);
      console.log(`    Last Changed: ${new Date(secret.LastChangedDate).toISOString()}`);
      console.log(`    Created: ${new Date(secret.CreatedDate).toISOString()}`);
      
      if (showDetails) {
        try {
          // Get detailed secret information
          const describeResult = await secretsmanager.describeSecret({ SecretId: secret.ARN }).promise();
          
          console.log(`    Status: ${describeResult.DeletedDate ? 'DELETED' : 'ACTIVE'}`);
          console.log(`    Version Count: ${describeResult.VersionIdsToStages ? Object.keys(describeResult.VersionIdsToStages).length : 0}`);
          
          if (describeResult.RotationEnabled) {
            console.log(`    Rotation: ENABLED (${describeResult.RotationRules?.AutomaticallyAfterDays || 'N/A'} days)`);
            if (describeResult.RotationLambdaARN) {
              console.log(`    Rotation Lambda: ${describeResult.RotationLambdaARN}`);
            }
          } else {
            console.log(`    Rotation: DISABLED`);
          }
          
          if (describeResult.Tags && describeResult.Tags.length > 0) {
            const tags = describeResult.Tags.map(t => `${t.Key}=${t.Value}`).join(', ');
            console.log(`    Tags: ${tags}`);
          }
          
          if (describeResult.ReplicationStatus && describeResult.ReplicationStatus.length > 0) {
            console.log(`    Replication: ${describeResult.ReplicationStatus.map(r => r.Region).join(', ')}`);
          }
        } catch (err) {
          console.log(`    (Could not fetch additional details: ${err.message})`);
        }
        
        // AWS Console link
        const consoleUrl = `https://${region}.console.aws.amazon.com/secretsmanager/secret?name=${encodeURIComponent(secret.Name)}&region=${region}`;
        console.log(`    Console URL: ${consoleUrl}`);
      }
      
      console.log('');
    }
  } catch (error) {
    console.error(`  Error listing secrets: ${error.message}\n`);
  }
}

async function listSSMParameters() {
  try {
    console.log('--- SSM Parameters ---');
    const result = await ssm.describeParameters({
      ParameterFilters: [
        { Key: 'Name', Option: 'BeginsWith', Values: ['catfish'] }
      ],
      MaxResults: 100
    }).promise();
    const parameters = result.Parameters || [];
    
    if (parameters.length === 0) {
      console.log('  No SSM parameters found for catfish\n');
      return;
    }

    for (const param of parameters) {
      console.log(`  Parameter: ${param.Name}`);
      console.log(`    Type: ${param.Type}`);
      console.log(`    Last Modified: ${new Date(param.LastModifiedDate).toISOString()}`);
      console.log('');
    }
  } catch (error) {
    console.error(`  Error listing SSM parameters: ${error.message}\n`);
  }
}

async function listCloudFormationStacks() {
  try {
    console.log('--- CloudFormation Stacks ---');
    const result = await cloudformation.listStacks({ StackStatusFilter: [] }).promise();
    const stacks = result.StackSummaries || [];
    const catfishStacks = stacks.filter(s => s.StackName.includes(serviceName) || s.StackName.includes('catfish'));
    
    if (catfishStacks.length === 0) {
      console.log(`  No CloudFormation stacks found for ${serviceName}\n`);
      return;
    }

    for (const stack of catfishStacks) {
      console.log(`  Stack: ${stack.StackName}`);
      console.log(`    Status: ${stack.StackStatus}`);
      console.log(`    Created: ${stack.CreationTime.toISOString()}`);
      console.log('');
    }
  } catch (error) {
    console.error(`  Error listing CloudFormation stacks: ${error.message}\n`);
  }
}

async function listLogGroups() {
  try {
    console.log('--- CloudWatch Log Groups ---');
    const result = await logs.describeLogGroups({ limit: 100 }).promise();
    const logGroups = result.logGroups || [];
    const catfishLogs = logGroups.filter(l => l.logGroupName.includes(serviceName) || l.logGroupName.includes('catfish'));
    
    if (catfishLogs.length === 0) {
      console.log(`  No log groups found for ${serviceName}\n`);
      return;
    }

    for (const logGroup of catfishLogs) {
      console.log(`  Log Group: ${logGroup.logGroupName}`);
      console.log(`    Size: ${(logGroup.storedBytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`    Created: ${new Date(logGroup.creationTime).toISOString()}`);
      console.log('');
    }
  } catch (error) {
    console.error(`  Error listing log groups: ${error.message}\n`);
  }
}

// CREATE OPERATIONS
async function createVPC(options) {
  const vpcName = options.name || `${serviceName}-${stage}-vpc`;
  const cidrBlock = options.cidr || '10.0.0.0/16';
  
  console.log(`\n=== Creating VPC: ${vpcName} ===\n`);
  console.log(`  CIDR Block: ${cidrBlock}\n`);

  try {
    // Create VPC
    const vpcResult = await ec2.createVpc({
      CidrBlock: cidrBlock,
      TagSpecifications: [{
        ResourceType: 'vpc',
        Tags: [
          { Key: 'Name', Value: vpcName },
          { Key: 'Service', Value: serviceName },
          { Key: 'Stage', Value: stage }
        ]
      }]
    }).promise();

    const vpcId = vpcResult.Vpc.VpcId;
    console.log(`✓ VPC created: ${vpcId}`);

    // Wait for VPC to be available
    await ec2.waitFor('vpcAvailable', { VpcIds: [vpcId] }).promise();

    // Enable DNS hostnames and DNS resolution
    await ec2.modifyVpcAttribute({
      VpcId: vpcId,
      EnableDnsHostnames: { Value: true }
    }).promise();

    await ec2.modifyVpcAttribute({
      VpcId: vpcId,
      EnableDnsSupport: { Value: true }
    }).promise();

    console.log(`✓ DNS hostnames and support enabled`);

    // Create Internet Gateway
    const igwResult = await ec2.createInternetGateway({
      TagSpecifications: [{
        ResourceType: 'internet-gateway',
        Tags: [
          { Key: 'Name', Value: `${vpcName}-igw` },
          { Key: 'Service', Value: serviceName }
        ]
      }]
    }).promise();

    const igwId = igwResult.InternetGateway.InternetGatewayId;
    await ec2.attachInternetGateway({
      InternetGatewayId: igwId,
      VpcId: vpcId
    }).promise();

    console.log(`✓ Internet Gateway created and attached: ${igwId}`);

    // Get availability zones
    const azResult = await ec2.describeAvailabilityZones().promise();
    const azs = azResult.AvailabilityZones.slice(0, 2).map(az => az.ZoneName);

    // Create subnets
    const subnets = [];
    for (let i = 0; i < azs.length; i++) {
      const subnetCidr = `10.0.${i + 1}.0/24`;
      const subnetResult = await ec2.createSubnet({
        VpcId: vpcId,
        CidrBlock: subnetCidr,
        AvailabilityZone: azs[i],
        TagSpecifications: [{
          ResourceType: 'subnet',
          Tags: [
            { Key: 'Name', Value: `${vpcName}-subnet-${i + 1}` },
            { Key: 'Service', Value: serviceName },
            { Key: 'Type', Value: i === 0 ? 'Public' : 'Private' }
          ]
        }]
      }).promise();

      subnets.push(subnetResult.Subnet.SubnetId);
      console.log(`✓ Subnet created: ${subnetResult.Subnet.SubnetId} (${subnetCidr}) in ${azs[i]}`);
    }

    // Create route table and route
    const routeTableResult = await ec2.createRouteTable({
      VpcId: vpcId,
      TagSpecifications: [{
        ResourceType: 'route-table',
        Tags: [
          { Key: 'Name', Value: `${vpcName}-rt` },
          { Key: 'Service', Value: serviceName }
        ]
      }]
    }).promise();

    const routeTableId = routeTableResult.RouteTable.RouteTableId;
    
    // Add route to internet gateway
    await ec2.createRoute({
      RouteTableId: routeTableId,
      DestinationCidrBlock: '0.0.0.0/0',
      GatewayId: igwId
    }).promise();

    // Associate route table with first subnet (public)
    await ec2.associateRouteTable({
      RouteTableId: routeTableId,
      SubnetId: subnets[0]
    }).promise();

    console.log(`✓ Route table created and configured: ${routeTableId}`);

    console.log(`\n✓ VPC setup complete!`);
    console.log(`\n  VPC ID: ${vpcId}`);
    console.log(`  Internet Gateway: ${igwId}`);
    console.log(`  Subnets: ${subnets.join(', ')}`);
    console.log(`  Route Table: ${routeTableId}\n`);

    return { vpcId, igwId, subnets, routeTableId };
  } catch (error) {
    console.error(`\n✗ Error creating VPC: ${error.message}\n`);
    throw error;
  }
}

async function createRDS(options) {
  const instanceId = options['instance-id'] || `${serviceName}-${stage}-db`;
  const engine = options.engine || 'postgres';
  const engineVersion = options['engine-version'] || (engine === 'postgres' ? '15.4' : '8.0.35');
  const instanceClass = options['instance-class'] || 'db.t3.micro';
  const allocatedStorage = parseInt(options['allocated-storage'] || '20');
  const masterUsername = options['master-username'] || 'admin';
  const masterPassword = options['master-password'] || uuidv4();
  const vpcId = options['vpc-id'];
  const subnetGroupName = options['subnet-group'] || `${serviceName}-${stage}-db-subnet-group`;

  console.log(`\n=== Creating RDS Instance: ${instanceId} ===\n`);
  console.log(`  Engine: ${engine} ${engineVersion}`);
  console.log(`  Instance Class: ${instanceClass}`);
  console.log(`  Storage: ${allocatedStorage}GB`);
  console.log(`  Master Username: ${masterUsername}\n`);

  if (!vpcId) {
    throw new Error('VPC ID is required. Use --vpc-id option or create a VPC first.');
  }

  try {
    // Get subnets for the VPC
    const subnets = await ec2.describeSubnets({
      Filters: [{ Name: 'vpc-id', Values: [vpcId] }]
    }).promise();

    if (subnets.Subnets.length === 0) {
      throw new Error('No subnets found in the specified VPC. Please create subnets first.');
    }

    const subnetIds = subnets.Subnets.map(s => s.SubnetId);

    // Create DB subnet group
    let dbSubnetGroupName = subnetGroupName;
    try {
      await rds.createDBSubnetGroup({
        DBSubnetGroupName: dbSubnetGroupName,
        DBSubnetGroupDescription: `DB subnet group for ${instanceId}`,
        SubnetIds: subnetIds,
        Tags: [
          { Key: 'Name', Value: dbSubnetGroupName },
          { Key: 'Service', Value: serviceName }
        ]
      }).promise();
      console.log(`✓ DB Subnet Group created: ${dbSubnetGroupName}`);
    } catch (error) {
      if (error.code === 'DBSubnetGroupAlreadyExists') {
        console.log(`ℹ DB Subnet Group already exists: ${dbSubnetGroupName}`);
      } else {
        throw error;
      }
    }

    // Get default VPC security group or create one
    const securityGroups = await ec2.describeSecurityGroups({
      Filters: [
        { Name: 'vpc-id', Values: [vpcId] },
        { Name: 'group-name', Values: ['default'] }
      ]
    }).promise();

    let securityGroupId;
    if (securityGroups.SecurityGroups.length > 0) {
      securityGroupId = securityGroups.SecurityGroups[0].GroupId;
    } else {
      // Create security group for RDS
      const sgResult = await ec2.createSecurityGroup({
        GroupName: `${instanceId}-sg`,
        Description: `Security group for ${instanceId}`,
        VpcId: vpcId,
        TagSpecifications: [{
          ResourceType: 'security-group',
          Tags: [
            { Key: 'Name', Value: `${instanceId}-sg` },
            { Key: 'Service', Value: serviceName }
          ]
        }]
      }).promise();
      securityGroupId = sgResult.GroupId;

      // Add rule to allow PostgreSQL/MySQL access (be careful in production!)
      const port = engine === 'postgres' ? 5432 : 3306;
      await ec2.authorizeSecurityGroupIngress({
        GroupId: securityGroupId,
        IpProtocol: 'tcp',
        FromPort: port,
        ToPort: port,
        CidrIp: '0.0.0.0/0' // WARNING: Restrict this in production!
      }).promise();

      console.log(`✓ Security Group created: ${securityGroupId} (Warning: open to all IPs)`);
    }

    // Create RDS instance
    const dbParams = {
      DBInstanceIdentifier: instanceId,
      DBInstanceClass: instanceClass,
      Engine: engine,
      EngineVersion: engineVersion,
      MasterUsername: masterUsername,
      MasterUserPassword: masterPassword,
      AllocatedStorage: allocatedStorage,
      DBSubnetGroupName: dbSubnetGroupName,
      VpcSecurityGroupIds: [securityGroupId],
      BackupRetentionPeriod: 7,
      StorageEncrypted: true,
      Tags: [
        { Key: 'Name', Value: instanceId },
        { Key: 'Service', Value: serviceName },
        { Key: 'Stage', Value: stage }
      ]
    };

    // Engine-specific parameters
    if (engine === 'postgres') {
      dbParams.PubliclyAccessible = false;
      dbParams.MultiAZ = false;
    }

    const dbResult = await rds.createDBInstance(dbParams).promise();
    console.log(`✓ RDS Instance creation started: ${instanceId}`);
    console.log(`\n  Note: RDS instance creation can take 5-15 minutes.`);
    console.log(`  Check status with: node resource-console.js list rds\n`);

    // Store credentials in Secrets Manager
    try {
      await secretsmanager.createSecret({
        Name: `catfish/${instanceId}-credentials`,
        Description: `Database credentials for ${instanceId}`,
        SecretString: JSON.stringify({
          username: masterUsername,
          password: masterPassword,
          instanceId: instanceId,
          engine: engine
        })
      }).promise();
      console.log(`✓ Credentials stored in Secrets Manager: catfish/${instanceId}-credentials`);
    } catch (error) {
      if (error.code !== 'ResourceExistsException') {
        console.warn(`⚠ Warning: Could not store credentials in Secrets Manager: ${error.message}`);
      }
    }

    return { instanceId, securityGroupId, dbSubnetGroupName };
  } catch (error) {
    console.error(`\n✗ Error creating RDS instance: ${error.message}\n`);
    throw error;
  }
}

// DELETE OPERATIONS
async function deleteVPC(options) {
  const vpcId = options['vpc-id'];
  
  if (!vpcId) {
    throw new Error('VPC ID is required. Use --vpc-id option.');
  }

  console.log(`\n=== Deleting VPC: ${vpcId} ===\n`);
  
  const confirmed = await promptConfirmation('This will delete the VPC and all associated resources. Continue? (y/n): ');
  if (!confirmed) {
    console.log('Deletion cancelled.\n');
    return;
  }

  try {
    // Get VPC details
    const vpcResult = await ec2.describeVpcs({ VpcIds: [vpcId] }).promise();
    if (vpcResult.Vpcs.length === 0) {
      throw new Error('VPC not found');
    }

    // Detach and delete Internet Gateways
    const igwResult = await ec2.describeInternetGateways({
      Filters: [{ Name: 'attachment.vpc-id', Values: [vpcId] }]
    }).promise();

    for (const igw of igwResult.InternetGateways) {
      await ec2.detachInternetGateway({
        InternetGatewayId: igw.InternetGatewayId,
        VpcId: vpcId
      }).promise();
      await ec2.deleteInternetGateway({ InternetGatewayId: igw.InternetGatewayId }).promise();
      console.log(`✓ Deleted Internet Gateway: ${igw.InternetGatewayId}`);
    }

    // Delete subnets
    const subnetsResult = await ec2.describeSubnets({
      Filters: [{ Name: 'vpc-id', Values: [vpcId] }]
    }).promise();

    for (const subnet of subnetsResult.Subnets) {
      await ec2.deleteSubnet({ SubnetId: subnet.SubnetId }).promise();
      console.log(`✓ Deleted Subnet: ${subnet.SubnetId}`);
    }

    // Delete route tables (except main)
    const routeTablesResult = await ec2.describeRouteTables({
      Filters: [{ Name: 'vpc-id', Values: [vpcId] }]
    }).promise();

    for (const rt of routeTablesResult.RouteTables) {
      if (!rt.Associations.some(a => a.Main)) {
        for (const association of rt.Associations) {
          await ec2.disassociateRouteTable({ AssociationId: association.RouteTableAssociationId }).promise();
        }
        await ec2.deleteRouteTable({ RouteTableId: rt.RouteTableId }).promise();
        console.log(`✓ Deleted Route Table: ${rt.RouteTableId}`);
      }
    }

    // Delete security groups (except default)
    const sgResult = await ec2.describeSecurityGroups({
      Filters: [{ Name: 'vpc-id', Values: [vpcId] }]
    }).promise();

    for (const sg of sgResult.SecurityGroups) {
      if (sg.GroupName !== 'default') {
        try {
          await ec2.deleteSecurityGroup({ GroupId: sg.GroupId }).promise();
          console.log(`✓ Deleted Security Group: ${sg.GroupId}`);
        } catch (e) {
          console.warn(`⚠ Could not delete Security Group ${sg.GroupId}: ${e.message}`);
        }
      }
    }

    // Delete VPC
    await ec2.deleteVpc({ VpcId: vpcId }).promise();
    console.log(`✓ Deleted VPC: ${vpcId}\n`);
  } catch (error) {
    console.error(`\n✗ Error deleting VPC: ${error.message}\n`);
    throw error;
  }
}

async function deleteRDS(options) {
  const instanceId = options['instance-id'];
  
  if (!instanceId) {
    throw new Error('RDS instance ID is required. Use --instance-id option.');
  }

  console.log(`\n=== Deleting RDS Instance: ${instanceId} ===\n`);
  
  const skipSnapshot = options['skip-snapshot'] === 'true';
  const confirmed = await promptConfirmation(
    `This will ${skipSnapshot ? 'delete' : 'create a final snapshot and delete'} the RDS instance. Continue? (y/n): `
  );
  if (!confirmed) {
    console.log('Deletion cancelled.\n');
    return;
  }

  try {
    const params = {
      DBInstanceIdentifier: instanceId,
      SkipFinalSnapshot: skipSnapshot
    };

    if (!skipSnapshot) {
      params.FinalDBSnapshotIdentifier = `${instanceId}-final-snapshot-${Date.now()}`;
    }

    await rds.deleteDBInstance(params).promise();
    console.log(`✓ RDS Instance deletion started: ${instanceId}`);
    console.log(`  Note: Deletion can take 5-15 minutes.\n`);
  } catch (error) {
    console.error(`\n✗ Error deleting RDS instance: ${error.message}\n`);
    throw error;
  }
}

async function createSecret(options) {
  const secretName = options.name;
  const secretValue = options.value || options['secret-string'];
  const description = options.description || `Secret for ${secretName}`;
  
  if (!secretName) {
    throw new Error('Secret name is required. Use --name option.');
  }
  
  if (!secretValue) {
    throw new Error('Secret value is required. Use --value or --secret-string option.');
  }

  console.log(`\n=== Creating Secret: ${secretName} ===\n`);

  try {
    // Ensure secret name starts with catfish/ prefix if not already
    const fullSecretName = secretName.startsWith('catfish/') ? secretName : `catfish/${secretName}`;
    
    const params = {
      Name: fullSecretName,
      Description: description,
      SecretString: secretValue,
      Tags: [
        { Key: 'Service', Value: serviceName },
        { Key: 'Stage', Value: stage },
        { Key: 'ManagedBy', Value: 'resource-console' }
      ]
    };

    const result = await secretsmanager.createSecret(params).promise();
    console.log(`✓ Secret created: ${fullSecretName}`);
    console.log(`  ARN: ${result.ARN}`);
    console.log(`  Version ID: ${result.VersionId}`);
    
    // AWS Console link
    const consoleUrl = `https://${region}.console.aws.amazon.com/secretsmanager/secret?name=${encodeURIComponent(fullSecretName)}&region=${region}`;
    console.log(`  Console URL: ${consoleUrl}\n`);
    
    return result;
  } catch (error) {
    if (error.code === 'ResourceExistsException') {
      console.error(`\n✗ Secret already exists: ${secretName}`);
      console.error(`  Use 'update secret' command to update it.\n`);
    } else {
      console.error(`\n✗ Error creating secret: ${error.message}\n`);
    }
    throw error;
  }
}

async function updateSecret(options) {
  const secretName = options.name;
  const secretValue = options.value || options['secret-string'];
  
  if (!secretName) {
    throw new Error('Secret name is required. Use --name option.');
  }
  
  if (!secretValue) {
    throw new Error('Secret value is required. Use --value or --secret-string option.');
  }

  console.log(`\n=== Updating Secret: ${secretName} ===\n`);

  try {
    // Ensure secret name starts with catfish/ prefix if not already
    const fullSecretName = secretName.startsWith('catfish/') ? secretName : `catfish/${secretName}`;
    
    const params = {
      SecretId: fullSecretName,
      SecretString: secretValue
    };

    const result = await secretsmanager.updateSecret(params).promise();
    console.log(`✓ Secret updated: ${fullSecretName}`);
    console.log(`  ARN: ${result.ARN}`);
    console.log(`  Version ID: ${result.VersionId}\n`);
    
    return result;
  } catch (error) {
    console.error(`\n✗ Error updating secret: ${error.message}\n`);
    throw error;
  }
}

async function deleteSecret(options) {
  const secretName = options.name;
  const recoveryWindow = parseInt(options['recovery-window'] || '30'); // Default 30 days
  
  if (!secretName) {
    throw new Error('Secret name is required. Use --name option.');
  }

  console.log(`\n=== Deleting Secret: ${secretName} ===\n`);
  console.log(`  Recovery Window: ${recoveryWindow} days (secret can be restored within this period)\n`);
  
  const confirmed = await promptConfirmation('This will schedule the secret for deletion. Continue? (y/n): ');
  if (!confirmed) {
    console.log('Deletion cancelled.\n');
    return;
  }

  try {
    // Ensure secret name starts with catfish/ prefix if not already
    const fullSecretName = secretName.startsWith('catfish/') ? secretName : `catfish/${secretName}`;
    
    const params = {
      SecretId: fullSecretName,
      RecoveryWindowInDays: recoveryWindow
    };

    // Check if force delete is requested
    if (options.force === 'true') {
      delete params.RecoveryWindowInDays;
      params.ForceDeleteWithoutRecovery = true;
      console.log(`  Force delete: enabled (no recovery window)\n`);
    }

    const result = await secretsmanager.deleteSecret(params).promise();
    console.log(`✓ Secret scheduled for deletion: ${fullSecretName}`);
    console.log(`  ARN: ${result.ARN}`);
    console.log(`  Deletion Date: ${new Date(result.DeletionDate).toISOString()}`);
    
    if (!options.force) {
      console.log(`  Note: Secret will be permanently deleted after ${recoveryWindow} days.\n`);
    } else {
      console.log(`  Note: Secret has been permanently deleted.\n`);
    }
    
    return result;
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      console.error(`\n✗ Secret not found: ${secretName}\n`);
    } else {
      console.error(`\n✗ Error deleting secret: ${error.message}\n`);
    }
    throw error;
  }
}

// MAIN EXECUTION
async function main() {
  const { command, resourceType, options } = parseArgs();

  if (!command) {
    console.log(`
AWS Resource Management Console

Usage:
  node resource-console.js <command> [resource-type] [options]

Commands:
  list    List resources (all, vpc, rds, lambda, s3, dynamodb, cognito, apigateway, secrets, ssm, cloudformation, logs)
  create  Create a resource (vpc, rds, secret)
  update  Update a resource (secret)
  delete  Delete a resource (vpc, rds, secret)

Examples:
  node resource-console.js list all
  node resource-console.js list vpc
  node resource-console.js list secrets --all
  node resource-console.js create vpc --name catfish-vpc --cidr 10.0.0.0/16
  node resource-console.js create rds --instance-id catfish-db --engine postgres --vpc-id vpc-123456
  node resource-console.js create secret --name hive-api-key --value "your-key" --description "Hive API key"
  node resource-console.js update secret --name hive-api-key --value "new-key"
  node resource-console.js delete vpc --vpc-id vpc-123456
  node resource-console.js delete rds --instance-id catfish-db --skip-snapshot true
  node resource-console.js delete secret --name hive-api-key --recovery-window 7

Environment Variables:
  AWS_REGION    AWS region (default: us-east-1)
  AWS_PROFILE   AWS profile (default: default)
  STAGE         Deployment stage (default: dev)
    `);
    process.exit(1);
  }

  try {
    switch (command.toLowerCase()) {
      case 'list':
        if (!resourceType || resourceType === 'all') {
          await listAll();
        } else {
          switch (resourceType.toLowerCase()) {
            case 'vpc':
              await listVPCs();
              break;
            case 'rds':
              await listRDSInstances();
              break;
            case 'lambda':
              await listLambdaFunctions();
              break;
            case 's3':
              await listS3Buckets();
              break;
            case 'dynamodb':
              await listDynamoDBTables();
              break;
            case 'cognito':
              await listCognitoUserPools();
              break;
            case 'apigateway':
              await listAPIGateways();
              break;
            case 'secrets':
              await listSecrets(options);
              break;
            case 'ssm':
              await listSSMParameters();
              break;
            case 'cloudformation':
              await listCloudFormationStacks();
              break;
            case 'logs':
              await listLogGroups();
              break;
            default:
              console.error(`Unknown resource type: ${resourceType}`);
              process.exit(1);
          }
        }
        break;

      case 'create':
        if (!resourceType) {
          console.error('Resource type is required for create command');
          process.exit(1);
        }
        switch (resourceType.toLowerCase()) {
          case 'vpc':
            await createVPC(options);
            break;
          case 'rds':
            await createRDS(options);
            break;
          case 'secret':
            await createSecret(options);
            break;
          default:
            console.error(`Cannot create resource type: ${resourceType}`);
            console.error('Supported types: vpc, rds, secret');
            process.exit(1);
        }
        break;

      case 'update':
        if (!resourceType) {
          console.error('Resource type is required for update command');
          process.exit(1);
        }
        switch (resourceType.toLowerCase()) {
          case 'secret':
            await updateSecret(options);
            break;
          default:
            console.error(`Cannot update resource type: ${resourceType}`);
            console.error('Supported types: secret');
            process.exit(1);
        }
        break;

      case 'delete':
        if (!resourceType) {
          console.error('Resource type is required for delete command');
          process.exit(1);
        }
        switch (resourceType.toLowerCase()) {
          case 'vpc':
            await deleteVPC(options);
            break;
          case 'rds':
            await deleteRDS(options);
            break;
          case 'secret':
            await deleteSecret(options);
            break;
          default:
            console.error(`Cannot delete resource type: ${resourceType}`);
            console.error('Supported types: vpc, rds, secret');
            process.exit(1);
        }
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`\n✗ Error: ${error.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  listAll,
  listVPCs,
  listRDSInstances,
  listSecrets,
  createVPC,
  createRDS,
  createSecret,
  updateSecret,
  deleteVPC,
  deleteRDS,
  deleteSecret
};

