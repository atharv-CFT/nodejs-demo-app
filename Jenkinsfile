pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                git branch: 'main', url: 'https://github.com/atharv-CFT/nodejs-demo-app.git'
            }
        }

        stage('Deploy') {
            steps {
                sshagent(['ec2-nodejs-demo-deploy']) {
                    bat 'ssh -o StrictHostKeyChecking=no ubuntu@3.234.243.108 "cd ~/Slack-notification/nodejs-demo-app && git pull && docker compose up -d --build"'
                }
            }
        }
    }

    post {
        success {
            script {
                sendSlackAlert("✅ SUCCESS: Job '${env.JOB_NAME}' build #${env.BUILD_NUMBER}\n${env.BUILD_URL}")
            }
        }
        failure {
            script {
                sendSlackAlert("❌ FAILED: Job '${env.JOB_NAME}' build #${env.BUILD_NUMBER}\n${env.BUILD_URL}")
            }
        }
        unstable {
            script {
                sendSlackAlert("⚠️ UNSTABLE: Job '${env.JOB_NAME}' build #${env.BUILD_NUMBER}\n${env.BUILD_URL}")
            }
        }
    }
}

// Sends a message to Slack using the webhook URL stored in Jenkins credential 'slack-webhook-url'
def sendSlackAlert(String messageText) {
    withCredentials([string(credentialsId: 'slack-webhook-url', variable: 'SLACK_WEBHOOK')]) {
        def payload = groovy.json.JsonOutput.toJson([text: messageText])
        httpRequest(
            url: "${SLACK_WEBHOOK}",
            httpMode: 'POST',
            contentType: 'APPLICATION_JSON',
            requestBody: payload
        )
    }
}
