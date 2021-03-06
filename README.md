# NextTrain
An experiment / learning project aiming to create a Facebook Messenger chat-bot leveraging AWS' serverless infrastructure.  This repo was  used to implement the [NextTrain NJ](https://www.youtube.com/watch?v=KGYNqNDJiuM) and NextTrain BART chat-bots, but can be expanded / adapted to create additional applications, and with a bit of restructuring, additional messaging platforms.

![System Overview](/doc/NextTrainNJ_diagram.png?raw=true "NextTrain.. System Overview")


## Facebook

A Facebook Messenger Bot is essentially a Facebook Application subscribed to receive messages from one or more Facebook Pages via a webhook handling Messenger API HTTP GETs and POSTs.   NextTrain NJ and NextTrain BART are both standard Facebook Pages.  *Next Train* is a Facebook application configured with a Messenger Webhook.  Facebook will perform an HTTP GET against the webhook URL to verify the application, and perform subsequent health checks.

*Next Train* is subscribed to receive Messages from the Next Train NJ and Next Train BART Pages.  Each subscription has a corresponding token which must be cached for the bot.  User messages are delivered to the bot as JSON delivered over HTTPS POSTS.  Responses can be routed back to the senders via a Sender ID and the Page's token.  Sender Id's are unique per user+page combination.  

## AWS

The initial goal was to create a BOT that would be serverless and able to operate entirely within the AWS free-tier.  This would be accomplished via API Gateway, Lambda, and DynamoDb.  The infrastructure was later expanded to include an ec2 instance (free tier), necessitated by addition of the OTP server.

### API Gateway

Implements the bot's web server for receiving requests from the Facebook Messenger infrastructure.  Requests are directed to the appropriate Lambda function.

### Lambda

The majority of the BOT functionality is implemented via the webhook Lambda function.  Secondary services for populating Messenger webviews with html for Itinieray details and lists of Stops are handled by the tripview and stopview functions.

#### webhook

The webhook function handles the initial bot verification HTTPS GET request sent by the Facebook Application webhook setup process, along with subsequent health checks.   The majority of the bot logic lies in handling Messages from Messenger, sent as HTTPS POSTS.  Since Messenger responses are also sent as POSTS, API Gateway is configured to deliver POSTS to the webhook using the async Service Integration. This keeps response times to the Facebook servers minimal, as the application logic is handled later in the function invocation.

Aside from managing Application verification, health checks, the webhook:
* Retrieves application and user configuration from DynamoDb.
* Performs text analysis via integration with Wit.ai.
* Invokes task specific handlers depending on the state of the user, and type of request.
* Locates stops and trip routes / timetables via an integration with the OTP Server.
* Stores individual trip data on S3 for subsequent presentation via the tripview function.
* Posts user responses back to Facebook.
* Updates the Dyanmodb with current user state.

#### tripview 

When the webhook finds trips and timetables for user requests, the results are summarized and sent back via Messenger, along with a URL to obtain more specific details (intermediate stops, transfers).  The link resolves back via API Gateway to the tripview function, the specific itinerary id passed as a query param.  The itinerary id is used to retrieve the trip details from S3, and then inserted into dynamically generated HTML passed back to the user.

#### stopview
The stopview lambda is used to provide BOT users with a full list of stops.  The list is generated by querying the OTP server and inserting the results into dynamically generated html.   NOTE.. since the stop change infrequently, the current implementation is using cached results, served via S3 via cloudfront.

### Dynamo Db
Used to store application configuration and user profile / state info.

#### applications
A record exists in the applications table for each corresponding Facebook Application.  Within the application configuration there is a sub-document for each *Next Train* Facebook Page subscription.  The application records, or page-specific sub-docs contain configuration along with tokens and keys used to communicate back to Facebook and other 3rd party services.   Adding an additional transit system bot requires creating a new Facebook Page, configuring the Facebook app to subscribe to that new page, and then adding a sub-document to the corresponding DynamoDb application for the new page.

#### users
The users table is used to hold basic profile details (name, profile pic, etc) about the Messenger users, along with their trip history, and the state of their current request.  The bot has read-write access to this table.

### ec2 / OTP Server
While the initial goal was to build the bot entirely using serverless infrastructure, the inclusion of the open source [Open Trip Planner](http://www.opentripplanner.org/) necessitated the addition of a server instance.  The OTP server is configured with GTFS data provided by the transit systems and provides a web service for finding stops and trip plans.

## wit.ai
Natural language processing is performed by [wit.ai](http://wit.ai).  All text sent by Messenger users is transmitted to wit for analysis.  The result of that analysis, a data-structure with parsed intent and associated entities (destination, times of day) is returned, and used by the bot to assign the correct request handler.  Configuration of the NLP is performed within the wit.ai web application.  Wit also provides tools for further training and fine tuning as the bot receives more traffic.





