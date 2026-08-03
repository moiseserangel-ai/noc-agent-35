import prisma from '../src/database/client.js';

const verifiedAt=new Date('2026-08-03T12:00:00-04:00');
const entries=[
  {vendor:'MikroTik',product:'RB3011UiAS-RM',lifecycleType:'hardware',productStatus:'discontinued',modelPattern:'*3011UiAS*',versionPattern:'*',sourceUrl:'https://mikrotik.com/product/RB3011UiAS-RM',sourceTitle:'MikroTik — RB3011UiAS-RM',notes:'A página oficial identifica o produto como Discontinued; o fabricante não informa uma data EOS nesta página.'},
  {vendor:'MikroTik',product:'RB2011iL-IN',lifecycleType:'hardware',productStatus:'discontinued',modelPattern:'*2011iL*',versionPattern:'*',sourceUrl:'https://mikrotik.com/product/RB2011iL-IN',sourceTitle:'MikroTik — RB2011iL-IN',notes:'A página oficial identifica o produto como Discontinued; o fabricante não informa uma data EOS nesta página.'},
  {vendor:'MikroTik',product:'hEX PoE lite (RB750UPr2)',lifecycleType:'hardware',productStatus:'active',modelPattern:'*750UP*r2*',versionPattern:'*',sourceUrl:'https://mikrotik.com/product/RB750UPr2',sourceTitle:'MikroTik — hEX PoE lite',notes:'Produto listado no catálogo oficial sem indicação de descontinuação na data da verificação.'},
  {vendor:'MikroTik',product:'hEX (RB750Gr3)',lifecycleType:'hardware',productStatus:'active',modelPattern:'*750Gr3*',versionPattern:'*',sourceUrl:'https://mikrotik.com/product/RB750Gr3',sourceTitle:'MikroTik — hEX',notes:'Produto listado no catálogo oficial sem indicação de descontinuação na data da verificação.'},
  {vendor:'MikroTik',product:'RB4011iGS+RM',lifecycleType:'hardware',productStatus:'active',modelPattern:'*4011iGS+*',versionPattern:'*',sourceUrl:'https://mikrotik.com/product/rb4011igs_rm',sourceTitle:'MikroTik — RB4011iGS+RM',notes:'Produto listado no catálogo oficial sem indicação de descontinuação na data da verificação.'},
  {vendor:'MikroTik',product:'Cloud Hosted Router (CHR)',lifecycleType:'software',productStatus:'active',modelPattern:'CHR*',versionPattern:'*',sourceUrl:'https://help.mikrotik.com/docs/spaces/ROS/pages/328149/RouterOS+license+keys',sourceTitle:'MikroTik — RouterOS license keys',notes:'A documentação oficial mantém os níveis e as condições de licenciamento do CHR.'}
];

for(const entry of entries){
  const key={vendor_product_modelPattern_versionPattern:{vendor:entry.vendor,product:entry.product,modelPattern:entry.modelPattern,versionPattern:entry.versionPattern}};
  await prisma.lifecycleCatalogEntry.upsert({where:key,create:{...entry,lastVerifiedAt:verifiedAt,createdBy:'official-import',updatedBy:'official-import'},update:{...entry,lastVerifiedAt:verifiedAt,isActive:true,updatedBy:'official-import'}});
}
console.log(JSON.stringify({imported:entries.length,verifiedAt:verifiedAt.toISOString()}));
await prisma.$disconnect();
