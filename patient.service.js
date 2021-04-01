const { loggers, resolveSchema } = require('@asymmetrik/node-fhir-server-core');
const logger = loggers.get('default');
const sqlite3 = require('sqlite3').verbose();
const Patient = resolveSchema('4_0_0', 'patient'); // const Patient = resolveSchema(args.base_version, 'patient'); args not available yet, so put in version directly
const BundleEntry = resolveSchema('4_0_0', 'bundleentry');
const Bundle = resolveSchema('4_0_0', 'bundle');
const { v4: uuidv4 } = require('uuid');

//Meta data for FHIR R4
let getMeta = (base_version) => {
    return require(FHIRServer.resolveFromVersion(base_version, RESOURCES.META));
};

function GetBaseUrl(context) {
    var baseUrl = "";
    const FHIRVersion = "/4_0_0/";
    var protocol = "http://";
    if (context.req.secure) { protocol = "https://"; }
    baseUrl = protocol + context.req.headers.host + FHIRVersion;
    return baseUrl;
};

// convert a person record into fhir patient resource
function mapPersonToPatientResource(person) {

    // define a new fhir patient resource instance
    let patient = new Patient

    // set data from person to patient resource instance
    patient.id = person.PRSN_ID.toString();
    patient.gender = person.PRSN_GENDER;
    patient.birthDate = person.PRSN_BIRTH_DATE;
    patient.telecom = [{
        "system": "email",
        "value": person.PRSN_EMAIL.toString(),
        "use":"home"
        }];

    //put all name related fields in the database to resourse.name
    patient.name = [
        {   
            use: "official",
            family: person.PRSN_LAST_NAME,
            given: [person.PRSN_FIRST_NAME, person.PRSN_SECOND_NAME],
            text: person.PRSN_FIRST_NAME + " " + person.PRSN_LAST_NAME
        }, 
        {   use: "nickname",
            given: [ person.PRSN_NICK_NAME ]
        }
    ]

    // patient.identifier = {return mapPersonDocToPatientIdentifier(person)}

    patient.text = {
        "status": "generated",
        "div": '<div xmlns="http://www.w3.org/1999/xhtml">' + patient.name[0] + "</div>"
    };

    return patient
}

// convert person doc information into patient identifier
function mapPersonDocToPatientIdentifier(person) {

    //every patient has the hospital_id as the default identifier
    var patientIdentifier = [{
        use: "official",
        system: "https://saintmartinhospital.org/patient-id",
        value: person.PRSN_ID,
        period: {start: person.PRSN_CREATE_DATE }
    }]

    //open a database conneciton
    const db = new sqlite3.Database('./persondb.db');
    let sql = `select * from PERSON_DOC where PERSON_DOC.PRDT_PRSN_ID = ?`;

    db.each(sql, [person.PRSN_ID],(err, personDoc) => {

        if (err) { throw err };

        if (personDoc) {

            switch (personDoc.PRDT_DCTP_ID) {
                case "1":
                    patientIdentifier.push({
                        use: "usual",
                        system: "https://www.national-office.gov/ni",
                        value: personDoc.PRDT_DOC_VALUE, 
                        period: {start: personDoc.PRDT_CREAT_DATE }
                    });
                    break;

                case "2":
                    patientIdentifier.push({
                        use: "official",
                        system: "https://www.foreign-affairs.gov/pp",
                        value: personDoc.PRDT_DOC_VALUE, 
                        period: {start: personDoc.PRDT_CREATE_DATE }
                    });
                    break;

                default: 
                    break;
            }          
        }
    })
    db.close()
    return patientIdentifier
}

function createPersonDocRecord(person,identifier) {

    let personDocObj;

    personDocObj.PRDT_PRSN_ID = person.PRSN_ID,
    personDocObj.PRDT_DOC_VALUE = identifier.value
    personDocObj.PRDT_CREATE_DATE = new Date().toISOString(),
    personDocObj.PRDT_DELETE_DATE = ''
    if (identifier.system === "https://www.national-office.gov/ni") personDocObj.PRDT_DCTP_ID = 1
    if (identifier.system === "https://www.foreign-affairs.gov/pp") personDocObj.PRDT_DCTP_ID = 1

    const personDocValues = personDocObj.values.join(',')

    const columnNames = (
        // "PRDT_ID", 
        "PRDT_PRSN_ID",
        "PRDT_DCTP_ID",
        "PRDT_DOC_VALUE",
        "PRDT_CREATE_DATE",
        "PRDT_DELETE_DATE"
        )
    
    // create new personDoc record in PERSON_DOC table
    const db = new sqlite3.Database('./persondb.db')
    const sql = `INSERT INTO PERSON_DOC ${columnNames} VALUES ?`
    db.run(sql, [personDocValues], (err) => {

        if (err) {
            return console.log(err.message);
          }

        // this.changes stores the row created from this query
        console.log(this)
        return this.changes
    })
    db.close();
}


//server offer search with these search parameters: family, gender, birthdate, _id, email, name
function search(args, context) { 

    logger.info('Patient >>> search');

    // Common search params, we only support _id
    // let { base_version, _content, _format, _id, _lastUpdated, _profile, _query, _security, _tag } = args;
    const {base_version, _id } = args;

    // Search Result params ,we only support _count
    // let { _INCLUDE, _REVINCLUDE, _SORT, _COUNT, _SUMMARY, _ELEMENTS, _CONTAINED, _CONTAINEDTYPED } = args;

    // resource specific searchs
    const {family, gender, birthDate, email, name} = args

    // Convert args to where condition clause. If a request contains a specific search parameter, we add it to condition clauses.
    let condition = [];
    if (family) { condition.push(`PRSN_LAST_NAME like "${family}"`)}
    if (gender) { condition.push(`PRSN_GENDER like "${gender}"`)}
    if (birthDate) { condition.push(`PRSN_BIRTH_DATE like "${birthdate}"`)}
    if (_id) { condition.push(`PRSN_ID like "${_id}"`)}
    if (email) { condition.push(`PRSN_EMAIL like "${email}"`)}
    if (name) { condition.push(`PRSN_LAST_NAME like "%${name}%" OR PRSN_FIRST_NAME like "%${name}%" OR PRSN_SECOND_NAME like "%${name}%"`)}
    condition = condition.join(' AND ')

    //open a database conneciton and query db with condition above
    const sql = `select * from PERSON WHERE ` + condition
    const db = new sqlite3.Database('./persondb.db')

    // db.serialize(() => {
        db.all(sql,(err, persons) => {
            if (err) { throw err };

            if (persons) { 
                // 1. convert person to patient resource
                let patientArray = persons.map((person) => {
                     let patient = mapPersonToPatientResource(person)
                     return patient
                    })

                // let patientArray = persons.map(person => mapPersonToPatientResource(person))

                let count = patientArray.length

                // //How to search the address of our server, so we can return it in the fullURL for each Patient entry

                // // convert person record into an patient resource object, count total patient rows
                var baseUrl = GetBaseUrl(context);

                //2. Assemble the patient objects into entries
                let entries = patientArray.map((patient) => {
                    let entry = new BundleEntry
                    return entry = {
                        fullUrl: baseUrl + '/Patient/' + patient.id,
                        resource: patient
                        }
                    })

                // 3. Assemble the entries into a search bundle With the type, total, entries, id, and meta
                var bundle = new Bundle ({
                        id: uuidv4(),
                        link: [{
                            relation: "self",
                            url: baseUrl + "Patient"
                        }],
                        meta: {
                            lastUpdated: new Date()
                        },
                        type: "searchset",
                        total: count,
                        entry: entries
                    });
                return bundle
            }
        })
    db.close()
    // })
}    


async function searchById(args, context) {
    
    const db = new sqlite3.Database('./persondb.db')

    let sql = `select * from PERSON where PRSN_ID = ?`

    let patient = db.get(sql, [args[_id]], (err,row) => {
        if (err) { throw err}
        // if (row === null) {operationOutcome read}
        if (row) {
            (person) => {return mapPersonToPatientResource(person)}
        }
    } )

    return patient
}

//The incoming request has context, which has one "req" object, which has request body,  which contains resourse. //Note: Only JSON is supported
// we extract values from request body and set it to different fields in the data table
async function create(args, context) {

    // Extract person values from context.req.body
    resource = context.req.body;

    lastName = resource.name[0].family;
    firstName = resource.name[0].given[0];
    secondName = resource.name[0].given[1];
    birthDate = resource.birthDate;
    gender = resource.gender;
    email = resource.telecom[0].value;
    nickname = resource.name[1].given[0];
    // the timestamp need to generated at creation
    createdAt = new Date().toISOString(),
    updatedAt = ''

    // Match value to keys(columnNames)
    let columnNames = (
        // "PRSN_ID",
        "PRSN_FIRST_NAME",
        "PRSN_SECOND_NAME",
        "PRSN_LAST_NAME",
        "PRSN_BIRTH_DATE",
        "PRSN_GENDER",
        "PRSN_EMAIL",
        "PRSN_NICK_NAME",
        "PRSN_CREATE_DATE",
        "PRSN_UPDATE_DATE"
        )

    let personValues = (
        firstName,
        secondName,
        lastName,
        birthDate,
        gender,
        email,
        nickname,
        createdAt,
        updateAt
    )

    const db = new sqlite3.Database('./persondb.db')

    // INSERT INTO table (column1,column2 ,..) VALUES( value1,	value2 ,...);
    let sql = `INSERT INTO PERSON ${columnNames} VALUES ?`
  
    let newPerson = db.run(sql, [personValues], (err) => {

      if (err) {
        return console.log(err.message);
      }
      // this.changes stores the row created from this query
      console.log(this)
      return this.changes

    });

    //if resource.identifier exist
    // Create a personDoc record, for each identifier entry
    identifierArray = resource.identifier
    if (identifierArray) { 

        identifierArray.forEach(identifier => createPersonDocRecord(newPerson,identifier))

    }

    //This is all the information that the response will have about the patient
    //the newId in Location
    // resolve({ id: newId });

    // What does fhir server returns after creating a resource
    return newPerson.id

}

module.exports = {
    mapPersonToPatientResource,
    mapPersonDocToPatientIdentifier,
    createPersonDocRecord,
    search, 
    searchById,
    create
}