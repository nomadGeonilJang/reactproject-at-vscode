const express = require('express');
const multer = require('multer');
const path = require('path');

const db= require('../models');
const {isLoggedIn} = require('./middlewares');


const router = express.Router();

const upload = multer({
  storage:multer.diskStorage({
    destination(req,file,done){
      done(null,'uploads')
    },
    filename(req,file,done){
      const ext = path.extname(file.originalname);
      const basename = path.basename(file.originalname,ext);
      done(null, basename + new Date().valueOf()+ext);
    }
  }),
  limits:{fileSize:20*1024*1024},
});


router.post('/', isLoggedIn, upload.none(), async (req, res, next) => {
  try {
    const post = req.body.content
    const hashtags = post.match(/#[^\s]+/gi);
    const newPost = await db.Post.create({
      content:post,
      UserId:req.user.id
    });
    if(hashtags){
      const result = await Promise.all(hashtags.map(tag => db.Hashtag.findOrCreate({
        where:{name:tag.slice(1).toLowerCase()}
      })));
      await newPost.addHashtags(result.map(r => r[0]));
    }
    /*
      const User = await newPost.getUser();
      newPost.User = User;
      res.json(newPost);
    */
    if(req.body.image){
      if(Array.isArray(req.body.image)){
        const images = await Promise.all(req.body.image.map(image => db.Image.create({src:image})));
        await newPost.addImages(images);
      }else{
        const image = await db.Image.create({src: req.body.image});
        await newPost.addImage(image);
      }
    }

    const fullPost = await db.Post.findOne({
      where:{id:newPost.id},
      include:[{
        model:db.User,
        attributes:['id','nickname']
      },{
        model:db.User,
        through:'Like',
        as:'Likers',
        attributes:['id']
      },{
        model:db.Image
      },{
        model:db.Post,
        as:'Retweet',
        include:[{
          model:db.User,
          attributes:['id','nickname']
        },{
          model:db.Image
        }]
      }]
    });
    res.json(fullPost.toJSON())
  } catch (e) {
    console.error(e);
    next(e);
  }
});

router.get(`/:id/comments`, async(req, res, next) => {
  try {
    const post = await db.Post.findOne({where:{id:req.params.id}});
    if(!post) return res.status(404).send('포스트가 존재하지 않습니다.');
    const comments = await db.Comment.findAll({
      where:{
        PostId:req.params.id,
      },
      order:[['createdAt','ASC']],
      include:[{
        model:db.User,
        attributes:['id','nickname']
      }]
    });
    res.json(comments)
  } catch (e) {
    console.error(e);
    next(e);
  }
});
router.post(`/:id/comment`, isLoggedIn, async(req, res, next) => {
  try {
    const post = await db.Post.findOne({where:{id:req.params.id}});
    if(!post) return res.status(404).send('포스트가 존재하지 않습니다.');
    const newComment = await db.Comment.create({
      PostId:post.id,
      UserId:req.user.id,
      content:req.body.content
    });
    //await post.addComment(newComment.id);
    const comment = await db.Comment.findOne({
      where:{id:newComment.id},
      include:[{
        model:db.User,
        attributes:['id','nickname']
      }]
    });
    res.json(comment)
  } catch (e) {
    console.error(e);
    next(e);
  }
});



router.post('/images', isLoggedIn, upload.array('image'), async (req, res, next)=> {
  const filenames = req.files.map(v=>v.filename);
  res.json(filenames);
});


router.post('/:id/like', isLoggedIn, async (req, res, next)=> {
  try {
    const post = await db.Post.findOne({where:{id:parseInt(req.params.id)}});
    if(!post) return res.status(404).send('포스트가 존재하지 않습니다.');
    await post.addLiker(req.user.id);
    res.json({
      userId:req.user.id
    })
  } catch (e) {
    console.error(e);
    next(e);
  }
});

router.delete('/:id/like', isLoggedIn, async (req, res, next)=> {
  try {
    const post = await db.Post.findOne({where:{id:parseInt(req.params.id)}});
    if(!post) return res.status(404).send('포스트가 존재하지 않습니다.');
    await post.removeLiker(req.user.id);
    res.json({
      userId:req.user.id
    })
  } catch (e) {
    console.error(e);
    next(e);
  }
});

router.post('/:id/retweet', isLoggedIn, async (req,res, next) => {
  try {
    const post = await db.Post.findOne({
      where:{id:parseInt(req.params.id)},
      include:[{
        model:db.Post,
        as:'Retweet'
      }]
    });
    if(!post) return req.status(404).send('포스트가 존재하지 않습니다.');
    if(req.user.id === post.UserId || (post.Retweet && post.Retweet.UserId === req.user.id)) return res.status(403).send('자신의 글은 리트윗 할 수 없습니다.');
    const retweetTargetId = post.RetweetId || post.id;
    const exPost = await db.Post.findOne({
      where:{
        UserId:req.user.id,
        RetweetId:retweetTargetId,
      }
    });
    if(exPost) return res.status(403).send('이미 리트윗 했습니다.');
    const retweet = await db.Post.create({
      UserId:req.user.id,
      RetweetId:retweetTargetId,
      content:'retweet'
    });
    const retweetWithPrevPost = await db.Post.findOne({
      where:{id:retweet.id},
      include:[{
        model:db.User,
        attributes:['id','nickname']
      },{
        model:db.Post,
        as:'Retweet',
        include:[{
          model:db.User,
          attributes:['id','nickname']
        },{
          model:db.Image
        }]
      }]
    });
    res.json(retweetWithPrevPost);
  } catch (e) {
    console.error(e);
    next(e)
  }
});

router.delete("/:id", isLoggedIn, async(req, res, next) => {
  try {
    const post = await db.Post.findOne({
      where:{id:req.params.id}
    });
    if(!post) return res.status(404).send('포스트가 존재하지 않습니다.');
    await db.Post.destroy({
      where:{
        id:req.params.id
      }
    });
    res.send(req.params.id);
  } catch (e) {
    console.error(e);
    next(e)
  }
});

router.get('/:id', async(req, res, next)=>{
  try {
    const post = await db.Post.findOne({
      where:{
        id:req.params.id
      },
      include:[{
        model:db.User,
        attributes:['id','nickname']
      },{
        model:db.Image
      }]
    })
    console.dir(post)
    res.json(post)
  } catch (e) {
    console.error(e);
    next(e);
  }
});





















module.exports = router;
